const baseUrl = () => {
  const url = process.env.SALESFORCE_INSTANCE_URL
  if (!url) return null
  return url.replace(/\/$/, "")
}

async function getAccessToken(): Promise<string | null> {
  const instanceUrl = baseUrl()
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  const username = process.env.SALESFORCE_USERNAME
  const password = process.env.SALESFORCE_PASSWORD
  if (!instanceUrl || !clientId || !clientSecret) return null

  const usePassword = username && password
  const params = new URLSearchParams({
    grant_type: usePassword ? "password" : "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    ...(usePassword && { username, password }),
  })

  const res = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!res.ok) return null

  const data = (await res.json()) as { access_token?: string; instance_url?: string }
  return data.access_token ?? null
}

export interface SalesforceLeadInput {
  name: string
  role: string
  company?: string
  email: string
  phone?: string
  message: string
}

export async function createLead(input: SalesforceLeadInput): Promise<boolean> {
  const instanceUrl = baseUrl()
  if (!instanceUrl) return false

  const token = await getAccessToken()
  if (!token) return false

  const res = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/Lead`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      LastName: input.name,
      Company: input.company?.trim() || "Website",
      Email: input.email,
      Phone: input.phone ?? null,
      Title: input.role,
      Description: input.message,
      LeadSource: process.env.SALESFORCE_LEAD_SOURCE ?? "Website",
    }),
  })

  if (!res.ok) return false

  return true
}
