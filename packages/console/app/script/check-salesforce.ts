#!/usr/bin/env bun

export {}

const url = process.env.SALESFORCE_INSTANCE_URL?.replace(/\/$/, "")
const clientId = process.env.SALESFORCE_CLIENT_ID
const clientSecret = process.env.SALESFORCE_CLIENT_SECRET

if (!url || !clientId || !clientSecret) {
  console.error("Missing SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID, or SALESFORCE_CLIENT_SECRET")
  process.exit(1)
}

const body = new URLSearchParams({
  grant_type: "client_credentials",
  client_id: clientId,
  client_secret: clientSecret,
})

async function main() {
  const auth = await fetch(`${url}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!auth.ok) {
    console.error("Salesforce auth failed", auth.status, await auth.text())
    process.exit(1)
  }

  const data = (await auth.json()) as { access_token?: string; instance_url?: string }
  if (!data.access_token) {
    console.error("Salesforce auth succeeded without an access token")
    process.exit(1)
  }

  const api = data.instance_url ?? url
  const res = await fetch(`${api}/services/data/v59.0/sobjects/Lead/describe`, {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
    },
  })

  if (!res.ok) {
    console.error("Salesforce Lead access failed", res.status, await res.text())
    process.exit(1)
  }

  console.log(`Salesforce Lead access ok: ${api}`)
}

await main().catch((err) => {
  console.error("Salesforce check failed:", err)
  process.exit(1)
})
