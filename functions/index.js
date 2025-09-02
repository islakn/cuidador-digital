const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Initialize Twilio client using Firebase config
const getTwilioClient = () => {
  const config = functions.config();
  if (!config.twilio || !config.twilio.sid || !config.twilio.token) {
    console.error('❌ Twilio configuration missing. Run: firebase functions:config:set twilio.sid="YOUR_SID" twilio.token="YOUR_TOKEN"');
    return null;
  }
  
  return twilio(config.twilio.sid, config.twilio.token);
};

// Helper function to format phone number for WhatsApp
const formatPhoneForWhatsApp = (phone) => {
  const digits = phone.replace(/\D/g, '');
  
  // Add country code if not present (assuming Brazil +55)
  if (digits.length === 10 || digits.length === 11) {
    return `whatsapp:+55${digits}`;
  }
  
  return `whatsapp:+${digits}`;
};

// Helper function to send WhatsApp message
const sendWhatsAppMessage = async (to, message) => {
  const twilioClient = getTwilioClient();
  
  if (!twilioClient) {
    console.error('❌ Twilio client not available');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    console.log(`📱 Sending WhatsApp to ${to}: ${message}`);
    
    const result = await twilioClient.messages.create({
      from: 'whatsapp:+14155238886', // Twilio Sandbox number
      to: formatPhoneForWhatsApp(to),
      body: message
    });

    console.log('✅ Message sent successfully:', result.sid);
    return { success: true, sid: result.sid, status: result.status };
    
  } catch (error) {
    console.error('❌ Twilio error:', error);
    return { success: false, error: error.message };
  }
};

// Helper function to create reminder message
const createReminderMessage = (nomeIdoso, medicacao, dosagem) => {
  return `Olá, ${nomeIdoso} 👋 — Hora do remédio ${medicacao} (${dosagem}). Responda: 1) ✅ Tomei 2) ❌ Não tomei 3) ⏳ Adiar 10 min.`;
};

// Helper function to get current time in Brazil timezone
const getCurrentBrazilTime = () => {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Helper function to get current day of week (0 = Sunday)
const getCurrentDayOfWeek = () => {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'numeric'
  });
};

// Scheduled function that runs every minute to check for medication reminders
exports.checkMedicationReminders = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    console.log('🔍 Checking for medication reminders...');
    
    try {
      const currentTime = getCurrentBrazilTime();
      const currentDay = parseInt(getCurrentDayOfWeek()) % 7; // Convert to 0-6 format
      
      console.log(`⏰ Current time: ${currentTime}, Day: ${currentDay}`);

      // Get all active medications
      const medicamentosSnapshot = await db
        .collection('medicamentos')
        .where('ativo', '==', true)
        .get();

      if (medicamentosSnapshot.empty) {
        console.log('📋 No active medications found');
        return null;
      }

      console.log(`📋 Found ${medicamentosSnapshot.size} active medications`);

      const batch = db.batch();
      let remindersToSend = [];

      for (const medicamentoDoc of medicamentosSnapshot.docs) {
        const medicamento = { id: medicamentoDoc.id, ...medicamentoDoc.data() };
        
        // Check if today is a scheduled day for this medication
        if (!medicamento.diasDaSemana.includes(currentDay)) {
          continue;
        }

        // Check if current time matches any of the scheduled times
        const isTimeToRemind = medicamento.horarios.some(horario => {
          const scheduledTime = horario.substring(0, 5); // Get HH:MM format
          return scheduledTime === currentTime;
        });

        if (isTimeToRemind) {
          console.log(`💊 Time to remind for medication: ${medicamento.nome}`);
          
          // Get idoso information
          const idosoDoc = await db.collection('idosos').doc(medicamento.idosoId).get();
          
          if (!idosoDoc.exists) {
            console.error(`❌ Idoso not found for medication ${medicamento.id}`);
            continue;
          }

          const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
          
          // Create reminder status record
          const lembreteStatusRef = db.collection('lembretes_status').doc();
          const lembreteStatus = {
            medicamentoId: medicamento.id,
            idosoId: idoso.id,
            dataHora: admin.firestore.FieldValue.serverTimestamp(),
            status: 'enviado',
            tentativas: 1,
            horarioOriginal: currentTime
          };

          batch.set(lembreteStatusRef, lembreteStatus);

          // Add to reminders to send
          remindersToSend.push({
            idoso,
            medicamento,
            lembreteId: lembreteStatusRef.id
          });
        }
      }

      // Commit all status updates
      if (remindersToSend.length > 0) {
        await batch.commit();
        console.log(`💾 Created ${remindersToSend.length} reminder status records`);
      }

      // Send WhatsApp messages
      for (const reminder of remindersToSend) {
        const message = createReminderMessage(
          reminder.idoso.nome,
          reminder.medicamento.nome,
          reminder.medicamento.dosagem
        );

        const result = await sendWhatsAppMessage(reminder.idoso.whatsapp, message);
        
        if (result.success) {
          console.log(`✅ Reminder sent to ${reminder.idoso.nome} (${reminder.idoso.whatsapp})`);
          
          // Update status with Twilio SID
          await db.collection('lembretes_status').doc(reminder.lembreteId).update({
            twilioSid: result.sid,
            twilioStatus: result.status
          });
        } else {
          console.error(`❌ Failed to send reminder to ${reminder.idoso.nome}:`, result.error);
          
          // Update status with error
          await db.collection('lembretes_status').doc(reminder.lembreteId).update({
            status: 'erro',
            erro: result.error
          });
        }
      }

      console.log(`✅ Processed ${remindersToSend.length} medication reminders`);
      return null;
      
    } catch (error) {
      console.error('❌ Error in checkMedicationReminders:', error);
      throw error;
    }
  });

// Function to handle WhatsApp webhook responses
exports.handleWhatsAppWebhook = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  try {
    const { From, Body } = req.body;
    const phoneNumber = From?.replace('whatsapp:', '') || '';
    const message = Body?.trim() || '';

    console.log(`📱 WhatsApp webhook: ${phoneNumber} -> ${message}`);

    // Find the idoso by phone number
    const idososSnapshot = await db
      .collection('idosos')
      .where('whatsapp', '==', phoneNumber.replace('+55', ''))
      .get();

    if (idososSnapshot.empty) {
      console.log(`❌ No idoso found for phone: ${phoneNumber}`);
      res.json({ success: false, error: 'Idoso not found' });
      return;
    }

    const idoso = { id: idososSnapshot.docs[0].id, ...idososSnapshot.docs[0].data() };

    if (['1', '2', '3'].includes(message)) {
      const statusMap = { '1': 'tomou', '2': 'nao_tomou', '3': 'adiado' };
      const newStatus = statusMap[message];

      // Find the most recent pending reminder for this idoso
      const lembreteSnapshot = await db
        .collection('lembretes_status')
        .where('idosoId', '==', idoso.id)
        .where('status', '==', 'enviado')
        .orderBy('dataHora', 'desc')
        .limit(1)
        .get();

      if (!lembreteSnapshot.empty) {
        const lembreteDoc = lembreteSnapshot.docs[0];
        
        await lembreteDoc.ref.update({
          status: newStatus,
          ultimaResposta: admin.firestore.FieldValue.serverTimestamp(),
          respostaRecebida: message
        });

        console.log(`✅ Updated reminder status to: ${newStatus}`);

        // If adiado (3), schedule a new reminder in 10 minutes
        if (message === '3') {
          const lembreteData = lembreteDoc.data();
          const medicamentoDoc = await db.collection('medicamentos').doc(lembreteData.medicamentoId).get();
          
          if (medicamentoDoc.exists) {
            const medicamento = medicamentoDoc.data();
            
            // Create delayed reminder
            const delayedReminderRef = db.collection('lembretes_status').doc();
            await delayedReminderRef.set({
              medicamentoId: lembreteData.medicamentoId,
              idosoId: idoso.id,
              dataHora: admin.firestore.FieldValue.serverTimestamp(),
              status: 'agendado_adiado',
              tentativas: 1,
              horarioOriginal: lembreteData.horarioOriginal,
              adiadoPor: 10 // minutes
            });

            console.log('⏰ Scheduled delayed reminder for 10 minutes');
          }
        }
      }

      // Send confirmation message
      const confirmationMessages = {
        '1': `Perfeito, ${idoso.nome}! ✔️ Registramos que você tomou o medicamento. Obrigado!`,
        '2': `Entendido. Foi registrado que o medicamento não foi tomado. Se precisar de ajuda, fale com seu responsável.`,
        '3': `Ok, vamos lembrar de novo em 10 minutos — responda 1 quando tomar :)`
      };

      await sendWhatsAppMessage(phoneNumber, confirmationMessages[message]);
      
    } else if (message.toLowerCase() === 'sair') {
      // Deactivate all medications for this idoso
      const medicamentosSnapshot = await db
        .collection('medicamentos')
        .where('idosoId', '==', idoso.id)
        .where('ativo', '==', true)
        .get();

      const batch = db.batch();
      medicamentosSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { ativo: false, desativadoEm: admin.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();

      await sendWhatsAppMessage(
        phoneNumber,
        `${idoso.nome}, os lembretes foram interrompidos conforme solicitado.\n\nPara reativar, entre em contato com seu responsável.\n\nCuide-se! 💙`
      );
      
      console.log(`🛑 Deactivated all medications for ${idoso.nome}`);
      
    } else {
      await sendWhatsAppMessage(
        phoneNumber,
        'Resposta não reconhecida. Responda:\n1 - Tomei\n2 - Não tomei\n3 - Adiar\nOu envie "SAIR" para parar.'
      );
    }

    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Error in WhatsApp webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Function to check for emergency alerts (no response after 20 minutes)
exports.checkEmergencyAlerts = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    console.log('🚨 Checking for emergency alerts...');
    
    try {
      const twentyMinutesAgo = new Date();
      twentyMinutesAgo.setMinutes(twentyMinutesAgo.getMinutes() - 20);

      // Find reminders sent more than 20 minutes ago without response
      const alertsSnapshot = await db
        .collection('lembretes_status')
        .where('status', '==', 'enviado')
        .where('dataHora', '<=', admin.firestore.Timestamp.fromDate(twentyMinutesAgo))
        .get();

      if (alertsSnapshot.empty) {
        console.log('✅ No emergency alerts needed');
        return null;
      }

      console.log(`🚨 Found ${alertsSnapshot.size} emergency alerts to send`);

      for (const alertDoc of alertsSnapshot.docs) {
        const alert = alertDoc.data();
        
        // Get idoso and medication info
        const [idosoDoc, medicamentoDoc] = await Promise.all([
          db.collection('idosos').doc(alert.idosoId).get(),
          db.collection('medicamentos').doc(alert.medicamentoId).get()
        ]);

        if (!idosoDoc.exists || !medicamentoDoc.exists) {
          console.error(`❌ Missing data for alert ${alertDoc.id}`);
          continue;
        }

        const idoso = idosoDoc.data();
        const medicamento = medicamentoDoc.data();

        // Get emergency contacts
        const contatosSnapshot = await db
          .collection('contatos_emergencia')
          .where('idosoId', '==', alert.idosoId)
          .get();

        // Get responsavel
        const responsavelDoc = await db.collection('responsaveis').doc(idoso.responsavelId).get();
        const responsavel = responsavelDoc.exists ? responsavelDoc.data() : null;

        // Prepare alert message
        const alertMessage = `⚠️ ALERTA: ${idoso.nome} não confirmou o medicamento ${medicamento.nome} das ${alert.horarioOriginal}.\n\nÚltimo lembrete enviado há mais de 20 minutos sem resposta.`;

        // Send alerts to emergency contacts
        const alertPromises = [];
        
        contatosSnapshot.docs.forEach(contatoDoc => {
          const contato = contatoDoc.data();
          alertPromises.push(sendWhatsAppMessage(contato.whatsapp, alertMessage));
        });

        // Also send to responsavel
        if (responsavel) {
          alertPromises.push(sendWhatsAppMessage(responsavel.whatsapp, alertMessage));
        }

        await Promise.all(alertPromises);

        // Update reminder status
        await alertDoc.ref.update({
          status: 'alerta_enviado',
          alertaEnviadoEm: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`🚨 Emergency alert sent for ${idoso.nome} - ${medicamento.nome}`);
      }

      console.log('✅ Emergency alerts processing completed');
      return null;
      
    } catch (error) {
      console.error('❌ Error in checkEmergencyAlerts:', error);
      throw error;
    }
  });

// Function to send daily reports
exports.sendDailyReports = functions.pubsub
  .schedule('every day 20:00')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    console.log('📊 Generating daily reports...');
    
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all responsaveis
      const responsaveisSnapshot = await db.collection('responsaveis').get();

      for (const responsavelDoc of responsaveisSnapshot.docs) {
        const responsavel = { id: responsavelDoc.id, ...responsavelDoc.data() };
        
        // Get idosos for this responsavel
        const idososSnapshot = await db
          .collection('idosos')
          .where('responsavelId', '==', responsavel.id)
          .get();

        for (const idosoDoc of idososSnapshot.docs) {
          const idoso = { id: idosoDoc.id, ...idosoDoc.data() };
          
          // Get today's reminders for this idoso
          const lembretesSnapshot = await db
            .collection('lembretes_status')
            .where('idosoId', '==', idoso.id)
            .where('dataHora', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('dataHora', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();

          // Calculate statistics
          let tomados = 0;
          let naoTomados = 0;
          let adiados = 0;
          let semResposta = 0;

          lembretesSnapshot.docs.forEach(doc => {
            const status = doc.data().status;
            switch (status) {
              case 'tomou': tomados++; break;
              case 'nao_tomou': naoTomados++; break;
              case 'adiado': adiados++; break;
              case 'enviado':
              case 'alerta_enviado': semResposta++; break;
            }
          });

          const total = tomados + naoTomados + adiados + semResposta;

          if (total > 0) {
            const reportMessage = `📊 Relatório diário — ${idoso.nome}\n\n✅ Tomados: ${tomados}/${total}\n❌ Não tomados: ${naoTomados}\n⏳ Adiados: ${adiados}\n⚠️ Sem resposta: ${semResposta}\n\nData: ${today.toLocaleDateString('pt-BR')}`;

            await sendWhatsAppMessage(responsavel.whatsapp, reportMessage);
            console.log(`📊 Daily report sent to ${responsavel.nome} for ${idoso.nome}`);
          }
        }
      }

      console.log('✅ Daily reports processing completed');
      return null;
      
    } catch (error) {
      console.error('❌ Error in sendDailyReports:', error);
      throw error;
    }
  });

// HTTP function for manual reminder testing
exports.sendManualReminder = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  try {
    const { idosoId, medicamentoId } = req.body;

    if (!idosoId || !medicamentoId) {
      res.status(400).json({ success: false, error: 'idosoId and medicamentoId are required' });
      return;
    }

    // Get idoso and medication data
    const [idosoDoc, medicamentoDoc] = await Promise.all([
      db.collection('idosos').doc(idosoId).get(),
      db.collection('medicamentos').doc(medicamentoId).get()
    ]);

    if (!idosoDoc.exists || !medicamentoDoc.exists) {
      res.status(404).json({ success: false, error: 'Idoso or medication not found' });
      return;
    }

    const idoso = idosoDoc.data();
    const medicamento = medicamentoDoc.data();

    // Create reminder status
    const lembreteStatusRef = db.collection('lembretes_status').doc();
    await lembreteStatusRef.set({
      medicamentoId,
      idosoId,
      dataHora: admin.firestore.FieldValue.serverTimestamp(),
      status: 'enviado',
      tentativas: 1,
      tipoEnvio: 'manual'
    });

    // Send reminder
    const message = createReminderMessage(idoso.nome, medicamento.nome, medicamento.dosagem);
    const result = await sendWhatsAppMessage(idoso.whatsapp, message);

    if (result.success) {
      await lembreteStatusRef.update({
        twilioSid: result.sid,
        twilioStatus: result.status
      });
    }

    res.json({
      success: result.success,
      message: 'Manual reminder sent',
      data: {
        lembreteId: lembreteStatusRef.id,
        twilioResult: result
      }
    });

  } catch (error) {
    console.error('❌ Error in sendManualReminder:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Function to get health status
exports.getHealthStatus = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  try {
    const twilioClient = getTwilioClient();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        firebase: true,
        twilio: !!twilioClient,
        timezone: 'America/Sao_Paulo'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});