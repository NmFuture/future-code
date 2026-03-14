import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"
import { AwsClient } from "aws4fetch"
import { fn } from "./util/fn"

export namespace AWS {
  let client: AwsClient

  const getCredentials = (): { accessKeyId: string; secretAccessKey: string } | null => {
    try {
      return {
        accessKeyId: Resource.AWS_SES_ACCESS_KEY_ID.value,
        secretAccessKey: Resource.AWS_SES_SECRET_ACCESS_KEY.value,
      }
    } catch {
      const id = process.env.AWS_SES_ACCESS_KEY_ID
      const secret = process.env.AWS_SES_SECRET_ACCESS_KEY
      if (!id || !secret) return null
      return { accessKeyId: id, secretAccessKey: secret }
    }
  }

  const createClient = () => {
    if (!client) {
      const creds = getCredentials()
      if (!creds) {
        throw new Error(
          "SES credentials not available. Run with `sst dev -- <command>` or set AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY in .env",
        )
      }
      client = new AwsClient({
        ...creds,
        region: "us-east-1",
      })
    }
    return client
  }

  export const hasSES = () => getCredentials() !== null

  export const sendEmail = fn(
    z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      replyTo: z.string().optional(),
    }),
    async (input) => {
      const res = await createClient().fetch("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails", {
        method: "POST",
        headers: {
          "X-Amz-Target": "SES.SendEmail",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          FromEmailAddress: `OpenCode Zen <contact@anoma.ly>`,
          Destination: {
            ToAddresses: [input.to],
          },
          ...(input.replyTo && { ReplyToAddresses: [input.replyTo] }),
          Content: {
            Simple: {
              Subject: {
                Charset: "UTF-8",
                Data: input.subject,
              },
              Body: {
                Text: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
                Html: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
              },
            },
          },
        }),
      })
      if (!res.ok) {
        throw new Error(`Failed to send email: ${res.statusText}`)
      }
    },
  )
}
