import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import twilioService from "./services/twilio.js";
import firebaseService from "./services/firebase.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração do CORS
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:4173",
      "http://localhost:5174",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middlewares para interpretar JSON e urlencoded
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Middleware de log das requisições
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Request body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// Rota de health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    port: PORT,
    services: {
      firebase: firebaseService.isConnected(),
      twilio: twilioService.isConnected(),
    },
  });
});

// Rota de registro
app.post("/api/registration", async (req, res) => {
  try {
    const { responsavel, idoso, contatos, medicamentos, lgpdConsent } = req.body;

    if (!responsavel || !idoso || !medicamentos || lgpdConsent !== true) {
      return res
        .status(400)
        .json({ success: false, error: "Dados obrigatórios faltando" });
    }

    const savedResponsavel = await firebaseService.saveResponsavel(responsavel);
    const savedIdoso = await firebaseService.saveIdoso({
      ...idoso,
      responsavelId: savedResponsavel.id,
    });
    const savedMedicamentos = await firebaseService.saveMedicamentos(
      medicamentos,
      savedIdoso.id
    );

    let savedContatos = [];
    if (contatos && contatos.length > 0) {
      savedContatos = await firebaseService.saveContatos(
        contatos,
        savedIdoso.id
      );
    }

    await firebaseService.saveLGPDConsent({
      responsavelId: savedResponsavel.id,
      aceito: lgpdConsent,
      dataAceite: new Date(),
      versao: "1.0",
    });

    const twilioResult = await twilioService.sendWelcomeMessage(savedIdoso);

    res.json({
      success: true,
      message: "Registro realizado com sucesso",
      data: {
        responsavelId: savedResponsavel.id,
        idosoId: savedIdoso.id,
        medicamentosCount: savedMedicamentos.length,
        contatosCount: savedContatos.length,
        twilioSent: twilioResult.success,
        twilioSid: twilioResult.sid,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook do WhatsApp
app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const { From, Body } = req.body;
    const phoneNumber = From?.replace("whatsapp:", "") || "";
    const message = Body?.trim() || "";

    if (["1", "2", "3"].includes(message)) {
      const statusMap = { "1": "tomou", "2": "nao_tomou", "3": "adiado" };
      await firebaseService.updateLembreteStatus(
        `temp_${Date.now()}`,
        statusMap[message]
      );

      const confirmationMessages = {
        "1": "Registramos que você tomou o medicamento.",
        "2": "Registrado que não foi tomado.",
        "3": "Adiado, lembraremos de novo em 10 minutos.",
      };

      await twilioService.sendWhatsAppMessage(
        phoneNumber,
        confirmationMessages[message]
      );
    } else if (message.toLowerCase() === "sair") {
      await twilioService.sendWhatsAppMessage(
        phoneNumber,
        "Lembretes interrompidos conforme solicitado."
      );
    } else {
      await twilioService.sendWhatsAppMessage(
        phoneNumber,
        "Resposta não reconhecida. Responda:\n1 - Tomei\n2 - Não tomei\n3 - Adiar\nOu envie 'SAIR' para parar."
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rota para enviar lembrete manual
app.post("/api/send-reminder", async (req, res) => {
  try {
    const mockIdoso = { nome: "Maria", whatsapp: process.env.TEST_PHONE_NUMBER };
    const mockMedicamento = { nome: "Losartana", dosagem: "50mg" };
    const result = await twilioService.sendMedicationReminder(
      mockIdoso,
      mockMedicamento
    );

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tratamento de erros globais
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  res.status(500).json({ success: false, error: err.message });
});

// Rota 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Rota não encontrada",
    path: req.originalUrl,
    method: req.method,
    availableRoutes: [
      "GET /api/health",
      "POST /api/registration",
      "POST /api/whatsapp/webhook",
      "POST /api/send-reminder",
    ],
  });
});

// Teste de envio de mensagem quando servidor inicia
if (process.env.NODE_ENV !== "production") {
  (async () => {
    try {
      const test = await twilioService.sendWhatsAppMessage(
        process.env.TEST_PHONE_NUMBER, // <-- AGORA PEGA DO .env
        "🚀 Servidor iniciado com sucesso! Essa é uma mensagem de teste."
      );
      console.log("Mensagem de teste Twilio:", test);
    } catch (err) {
      console.error("Erro no envio de teste Twilio:", err.message);
    }
  })();
}

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
