import { CodeBlock } from "@/components/copy-button";
import { PageHeader } from "@/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PARAMS: [string, string, string][] = [
  ["message", "string, required", "The body, up to 4096 characters."],
  ["title", "string", "Defaults to the app name."],
  ["to", "string or string[]", 'Recipients: "me" (default), "group:<slug>", or "user:<email>". Comma-separated strings work too.'],
  ["priority", "-2 to 2", "-2 feed only, -1 quiet, 0 normal, 1 high (stays on screen), 2 urgent (repeats until acknowledged)."],
  ["sound", "string", "A built-in sound or one of your uploaded sounds, by slug."],
  ["url", "string", "A link shown with the message."],
  ["url_title", "string", "Text for the link."],
  ["html", "boolean", "Allow <b>, <i>, <u>, <a href> and <font color> in the message."],
  ["ttl", "seconds", "Remove the message from feeds after this long."],
  ["retry", "seconds, ≥ 30", "Urgent only. How often to repeat. Default 60."],
  ["expire", "seconds, ≤ 10800", "Urgent only. When to stop repeating. Default 3600."],
  ["callback", "https URL", "Urgent only. Gets a POST when someone acknowledges the alert."],
];

export function DocsPage() {
  const origin = window.location.origin;
  return (
    <>
      <PageHeader title="API docs" description="Send notifications from anything that can make an HTTP request." />
      <div className="space-y-8 text-sm">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Authentication</h2>
          <p className="text-muted-foreground">
            Create an app on the <strong>Apps &amp; API keys</strong> page and use its key as a bearer token. You can also pass it
            as an <code>X-API-Key</code> header or a <code>token</code> field.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Send a message</h2>
          <p className="text-muted-foreground">
            <code>POST /api/v1/messages</code> accepts JSON, form-encoded or multipart bodies.
          </p>
          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
              <TabsTrigger value="js">JavaScript</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="curl">
              <CodeBlock
                code={`curl ${origin}/api/v1/messages \\
  -H "Authorization: Bearer $FLARE_KEY" \\
  -d title="Backup finished" \\
  -d message="Nightly backup completed in 4m 12s"`}
              />
            </TabsContent>
            <TabsContent value="json">
              <CodeBlock
                code={`curl ${origin}/api/v1/messages \\
  -H "Authorization: Bearer $FLARE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Disk almost full",
    "message": "/dev/sda1 is at 94%",
    "to": ["me", "group:ops"],
    "priority": 1,
    "sound": "klaxon",
    "url": "https://grafana.example.com/d/disk"
  }'`}
              />
            </TabsContent>
            <TabsContent value="js">
              <CodeBlock
                code={`await fetch("${origin}/api/v1/messages", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.FLARE_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ title: "Deploy", message: "v2.3.1 is live", to: "group:team" }),
});`}
              />
            </TabsContent>
            <TabsContent value="python">
              <CodeBlock
                code={`import os, requests

requests.post(
    "${origin}/api/v1/messages",
    headers={"Authorization": f"Bearer {os.environ['FLARE_KEY']}"},
    json={"title": "Job done", "message": "Training finished: loss 0.031"},
)`}
              />
            </TabsContent>
          </Tabs>
          <p className="text-muted-foreground">
            The response is <code>201</code> with <code>{`{ "id": "…", "recipients": 1 }`}</code>, plus a <code>receipt</code> for
            urgent messages. Errors return <code>{`{ "error": "…" }`}</code> with a 4xx status.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Parameters</h2>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PARAMS.map(([field, type, desc]) => (
                  <TableRow key={field}>
                    <TableCell className="font-mono text-xs">{field}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{type}</TableCell>
                    <TableCell className="text-xs whitespace-normal">{desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Urgent alerts and receipts</h2>
          <p className="text-muted-foreground">
            Priority 2 messages repeat every <code>retry</code> seconds until any recipient acknowledges them or{" "}
            <code>expire</code> passes. The response includes a <code>receipt</code> ID you can poll or cancel.
          </p>
          <CodeBlock
            code={`# Send
curl ${origin}/api/v1/messages -H "Authorization: Bearer $FLARE_KEY" \\
  -d message="Server down" -d priority=2 -d retry=60 -d expire=1800 -d to=group:oncall

# Check status
curl ${origin}/api/v1/receipts/$RECEIPT -H "Authorization: Bearer $FLARE_KEY"

# Stop repeating
curl -X POST ${origin}/api/v1/receipts/$RECEIPT/cancel -H "Authorization: Bearer $FLARE_KEY"`}
          />
          <p className="text-muted-foreground">
            If you set <code>callback</code>, Flare POSTs <code>receipt</code>, <code>acknowledged=1</code>,{" "}
            <code>acknowledged_at</code> (Unix seconds) and <code>acknowledged_by</code> (email) to it, form-encoded.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pushover-compatible endpoint</h2>
          <p className="text-muted-foreground">
            Tools that support Pushover (Home Assistant, Uptime Kuma, Healthchecks and others) can use Flare by pointing them at{" "}
            <code>{origin}/1/messages.json</code>. Use your Flare API key as the <em>application token</em>, and <code>me</code>,
            a group slug or an email as the <em>user key</em>.
          </p>
          <CodeBlock
            code={`curl ${origin}/1/messages.json \\
  --form-string "token=$FLARE_KEY" \\
  --form-string "user=me" \\
  --form-string "message=hello world"`}
          />
        </section>
      </div>
    </>
  );
}
