import axios from 'axios'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 5000,
})