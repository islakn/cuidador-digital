// server/services/twilio.js
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

class TwilioService {
  constructor() {
    this.accountSid = process.env.VITE_TWILIO_ACCOUNT_SID;
    this.authToken = process.env.VITE_TWILIO_AUTH_TOKEN;

    // No sandbox do Twilio, o número é fixo:
    this.phoneNumber = 'whatsapp:+14155238886';

    this.mockMode = true;
    this.connected = false;

    if (!this.accountSid || !this.authToken) {
      console.warn('⚠️ Twilio credentials not configured. Messages will be logged only.');
      console.log('💡 To enable Twilio, set these environment variables:');
      console.log('   - VITE_TWILIO_ACCOUNT_SID');
      console.log('   - VITE_TWILIO_AUTH_TOKEN');
    } else {
      try {
        this.client = twilio(this.accountSid, this.authToken);
        console.log('📱 Twilio client initialized successfully');
        this.mockMode = false;
        this.connected = true;
      } catch (error) {
        console.error('❌ Twilio initialization error:', error);
        this.mockMode = true;
        this.connected = false;
      }
    }
  }

  isConnected() {
    return this.connected;
  }

  async sendWhatsAppMessage(to, message) {
    try {
      console.log(`📱 Sending WhatsApp to ${to}:`);
      console.log(`📝 Message: ${message}`);

      if (this.mockMode) {
        console.log('🔄 Twilio not configured - message logged only');
        return {
          success: true,
          mock: true,
          sid: `SM_mock_${Date.now()}`,
          status: 'sent',
          to: to,
          message: message
        };
      }

      // Format phone number for WhatsApp
      const formattedTo = to.startsWith('+') ? `whatsapp:${to}` : `whatsapp:+55${to.replace(/\D/g, '')}`;
      const formattedFrom = this.phoneNumber; // sempre whatsapp:+14155238886 no sandbox

      console.log(`📱 Formatted numbers: ${formattedFrom} -> ${formattedTo}`);

      const result = await this.client.messages.create({
        from: formattedFrom,
        to: formattedTo,
        body: message
      });

      console.log('✅ Message sent successfully:', result.sid);
      return {
        success: true,
        data: result,
        sid: result.sid,
        status: result.status,
        to: formattedTo,
        message: message
      };

    } catch (error) {
      console.error('❌ Twilio error:', error);
      console.error('📊 Error details:', error.message);

      return {
        success: false,
        error: error.message,
        mock: this.mockMode,
        to: to,
        message: message
      };
    }
  }

  async sendMedicationReminder(idoso, medicamento) {
    const message = `Olá, ${idoso.nome} 👋 — Hora do remédio ${medicamento.nome} (${medicamento.dosagem}). Responda: 1) ✅ Tomei 2) ❌ Não tomei 3) ⏳ Adiar 10 min.`;
    return await this.sendWhatsAppMessage(idoso.whatsapp, message);
  }

  async sendWelcomeMessage(idoso) {
    const message = `Olá, ${idoso.nome}! 👋\n\nSou o Cuidador Digital e vou te ajudar a lembrar dos seus medicamentos.\n\nQuando receber um lembrete, responda:\n1️⃣ para "Tomei"\n2️⃣ para "Não tomei"\n3️⃣ para "Adiar 10 min"\n\nPara parar os lembretes, envie "SAIR".\n\nVamos cuidar da sua saúde juntos! 💙`;
    return await this.sendWhatsAppMessage(idoso.whatsapp, message);
  }

  async sendConfirmationMessage(idoso, medicamento, response) {
    const messages = {
      '1': `Perfeito, ${idoso.nome}! ✔️ Registramos que você tomou ${medicamento.nome}. Obrigado!`,
      '2': `Entendido. Foi registrado que ${medicamento.nome} não foi tomado. Se precisar de ajuda, fale com seu responsável.`,
      '3': `Ok, vamos lembrar de novo em 10 minutos — responda 1 quando tomar :)`
    };

    const message = messages[response] || 'Resposta não reconhecida. Responda: 1, 2 ou 3.';
    return await this.sendWhatsAppMessage(idoso.whatsapp, message);
  }

  async sendEmergencyAlert(contatos, idoso, medicamento, horario) {
    const message = `⚠️ Alerta: ${idoso.nome} não confirmou o remédio ${medicamento.nome} das ${horario}.`;

    const promises = contatos.map(contato =>
      this.sendWhatsAppMessage(contato.whatsapp, message)
    );

    return await Promise.all(promises);
  }

  async sendDailyReport(responsavel, idoso, relatorio) {
    const message = `📊 Relatório de hoje — ${idoso.nome}\n\n✅ Tomados: ${relatorio.tomados}/${relatorio.total}\n❌ Não tomados: ${relatorio.naoTomados}\n⏳ Adiados: ${relatorio.adiados}`;
    return await this.sendWhatsAppMessage(responsavel.whatsapp, message);
  }
}

export default new TwilioService();
