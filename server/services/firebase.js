// Firebase service for data storage
import admin from "firebase-admin";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

class FirebaseService {
  constructor() {
    this.mockMode = true;
    this.connected = false;

    try {
      if (!admin.apps.length) {
        // Caminho do arquivo JSON da service account
        const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (serviceAccountPath) {
          console.log("🔥 Initializing Firebase with service account file...");

          const serviceAccount = JSON.parse(
            fs.readFileSync(path.resolve(serviceAccountPath), "utf-8")
          );

          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL,
          });

          this.mockMode = false;
          this.connected = true;
        } else if (process.env.VITE_FIREBASE_PROJECT_ID) {
          console.log("🔥 Initializing Firebase with project ID...");
          admin.initializeApp({
            projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          });
          this.mockMode = false;
          this.connected = true;
        } else {
          console.log("🔥 No Firebase credentials found, running in mock mode");
        }
      }

      if (!this.mockMode) {
        this.db = admin.firestore();
        console.log("🔥 Firebase Admin SDK initialized successfully");
      } else {
        console.log("🔥 Firebase service initialized (mock mode)");
      }
    } catch (error) {
      console.error("❌ Firebase initialization error:", error);
      this.mockMode = true;
      this.connected = false;
      console.log("🔥 Falling back to mock mode");
    }
  }

  isConnected() {
    return this.connected;
  }

  async saveResponsavel(data) {
    try {
      console.log("💾 Saving responsavel to Firebase:", data);

      if (this.mockMode) {
        const id = `resp_${Date.now()}`;
        return { id, ...data, createdAt: new Date() };
      }

      const docRef = await this.db.collection("responsaveis").add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { id: docRef.id, ...data, createdAt: new Date() };
    } catch (error) {
      console.error("❌ Error saving responsavel:", error);
      throw new Error(`Failed to save responsavel: ${error.message}`);
    }
  }

  async saveIdoso(data) {
    try {
      console.log("💾 Saving idoso to Firebase:", data);

      if (this.mockMode) {
        const id = `idoso_${Date.now()}`;
        return { id, ...data, createdAt: new Date() };
      }

      const docRef = await this.db.collection("idosos").add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { id: docRef.id, ...data, createdAt: new Date() };
    } catch (error) {
      console.error("❌ Error saving idoso:", error);
      throw new Error(`Failed to save idoso: ${error.message}`);
    }
  }

  async saveMedicamentos(medicamentos, idosoId) {
    try {
      console.log("💾 Saving medicamentos to Firebase:", medicamentos);

      if (this.mockMode) {
        return medicamentos.map((med, index) => ({
          id: `med_${Date.now()}_${index}`,
          ...med,
          idosoId,
          ativo: true,
          createdAt: new Date(),
        }));
      }

      const batch = this.db.batch();
      const savedMedicamentos = [];

      for (let i = 0; i < medicamentos.length; i++) {
        const med = medicamentos[i];
        const docRef = this.db.collection("medicamentos").doc();

        batch.set(docRef, {
          ...med,
          idosoId,
          ativo: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        savedMedicamentos.push({
          id: docRef.id,
          ...med,
          idosoId,
          ativo: true,
          createdAt: new Date(),
        });
      }

      await batch.commit();
      return savedMedicamentos;
    } catch (error) {
      console.error("❌ Error saving medicamentos:", error);
      throw new Error(`Failed to save medicamentos: ${error.message}`);
    }
  }

  async saveContatos(contatos, idosoId) {
    try {
      console.log("💾 Saving contatos to Firebase:", contatos);

      if (this.mockMode) {
        return contatos.map((contato, index) => ({
          id: `contato_${Date.now()}_${index}`,
          ...contato,
          idosoId,
          createdAt: new Date(),
        }));
      }

      const batch = this.db.batch();
      const savedContatos = [];

      for (let i = 0; i < contatos.length; i++) {
        const contato = contatos[i];
        const docRef = this.db.collection("contatos_emergencia").doc();

        batch.set(docRef, {
          ...contato,
          idosoId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        savedContatos.push({
          id: docRef.id,
          ...contato,
          idosoId,
          createdAt: new Date(),
        });
      }

      await batch.commit();
      return savedContatos;
    } catch (error) {
      console.error("❌ Error saving contatos:", error);
      throw new Error(`Failed to save contatos: ${error.message}`);
    }
  }

  async saveLGPDConsent(data) {
    try {
      console.log("💾 Saving LGPD consent to Firebase:", data);

      if (this.mockMode) {
        return { id: `lgpd_${Date.now()}`, ...data, createdAt: new Date() };
      }

      const docRef = await this.db.collection("lgpd_consents").add({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { id: docRef.id, ...data, createdAt: new Date() };
    } catch (error) {
      console.error("❌ Error saving LGPD consent:", error);
      throw new Error(`Failed to save LGPD consent: ${error.message}`);
    }
  }

  async updateLembreteStatus(lembreteId, status) {
    try {
      console.log(`💾 Updating lembrete status: ${lembreteId} -> ${status}`);

      if (this.mockMode) {
        return { success: true };
      }

      await this.db.collection("lembretes_status").doc(lembreteId).update({
        status,
        ultimaResposta: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      console.error("❌ Error updating lembrete status:", error);
      throw new Error(`Failed to update lembrete status: ${error.message}`);
    }
  }
}

export default new FirebaseService();
