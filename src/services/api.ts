// API service for backend communication

const API_BASE_URL = 'http://localhost:3001';

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async post(endpoint: string, data: any) {
    try {
      console.log(`🔄 API POST to: ${this.baseUrl}${endpoint}`);
      console.log('📤 Request data:', JSON.stringify(data, null, 2));
      
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      console.log(`📥 Response status: ${response.status} ${response.statusText}`);

      const result = await response.json();
      console.log('📥 Response data:', result);

      if (!response.ok) {
        console.error(`❌ API Error Response:`, result);
        throw new Error(result.error || result.message || `HTTP error! status: ${response.status}`);
      }

      console.log('✅ API Success:', result);
      return result;
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      
      // Provide more specific error messages
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to backend server at ${this.baseUrl}. Make sure the backend is running on port 3001.`);
      }
      
      throw error;
    }
  }

  async get(endpoint: string) {
    try {
      console.log(`🔄 API GET to: ${this.baseUrl}${endpoint}`);
      
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      
      const result = await response.json();
      
      if (!response.ok) {
        console.error(`❌ API Error Response:`, result);
        throw new Error(result.error || result.message || `HTTP error! status: ${response.status}`);
      }

      console.log('✅ API Success:', result);
      return result;
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to backend server at ${this.baseUrl}. Make sure the backend is running.`);
      }
      
      throw error;
    }
  }

  // Specific methods for the Cuidador Digital API
  async saveRegistration(formData: any) {
    console.log('🚀 Submitting registration to backend...');
    return await this.post('/api/registration', formData);
  }

  async sendManualReminder(data: any) {
    return await this.post('/api/send-reminder', data);
  }

  async checkHealth() {
    return await this.get('/api/health');
  }

  async generateReport(idosoId: string, date: string) {
    return await this.get(`/api/reports/${idosoId}/${date}`);
  }
}

export const apiService = new ApiService();