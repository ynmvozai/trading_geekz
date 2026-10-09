// Crea y configura el servicio en Railway por API (GraphQL). Uso:
//   RAILWAY_TOKEN=... node scripts/railway-deploy.mjs [crear|estado|desplegar|region <id>]
// El token es de cuenta (railway.com/account/tokens). Nunca se imprime ni se guarda.
import fs from "node:fs";
const API = "https://backboard.railway.com/graphql/v2";
const TOKEN = process.env.RAILWAY_TOKEN;
if (!TOKEN) { console.error("Falta RAILWAY_TOKEN"); process.exit(1); }
const STATE = new URL("./.railway-ids.json", import.meta.url); // ids (no secretos), ignorado por git
const ids = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(ids, null, 1));

async function gql(query, variables = {}) {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return j.data;
}

const REPO = "ynmvozai/trading_geekz", REGION = process.env.REGION || "europe-west4-drams3a";

async function crear() {
  if (!ids.projectId) {
    const d = await gql(`mutation($i: ProjectCreateInput!){ projectCreate(input:$i){ id environments{ edges{ node{ id name } } } } }`, { i: { name: process.env.PROJECT_NAME || "trading_geekz" } });
    ids.projectId = d.projectCreate.id;
    ids.environmentId = d.projectCreate.environments.edges[0].node.id;
    save(); console.log("Proyecto creado");
  }
  if (!ids.serviceId) {
    const d = await gql(`mutation($i: ServiceCreateInput!){ serviceCreate(input:$i){ id } }`, { i: { projectId: ids.projectId, name: "hotzone-server", source: { repo: REPO }, branch: "main" } });
    ids.serviceId = d.serviceCreate.id; save(); console.log("Servicio creado");
  }
  await gql(`mutation($s:String!,$e:String!,$i: ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }`,
    { s: ids.serviceId, e: ids.environmentId, i: { rootDirectory: "/server", railwayConfigFile: "/server/railway.json", multiRegionConfig: { [REGION]: { numReplicas: 1 } } } });
  console.log("Root /server, config /server/railway.json, región", REGION);
  if (!ids.volumeId) {
    const d = await gql(`mutation($i: VolumeCreateInput!){ volumeCreate(input:$i){ id } }`, { i: { projectId: ids.projectId, serviceId: ids.serviceId, environmentId: ids.environmentId, mountPath: "/data" } });
    ids.volumeId = d.volumeCreate.id; save(); console.log("Volumen /data creado");
  }
  await gql(`mutation($i: VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$i) }`,
    { i: { projectId: ids.projectId, environmentId: ids.environmentId, serviceId: ids.serviceId, variables: { TZ: "America/Puerto_Rico" }, skipDeploys: true } });
  if (!ids.domain) {
    const d = await gql(`mutation($i: ServiceDomainCreateInput!){ serviceDomainCreate(input:$i){ domain } }`, { i: { serviceId: ids.serviceId, environmentId: ids.environmentId, targetPort: 8080 } });
    ids.domain = d.serviceDomainCreate.domain; save();
  }
  console.log("Dominio: https://" + ids.domain);
  console.log("Variables: https://railway.com/project/" + ids.projectId + "/service/" + ids.serviceId + "/variables?environmentId=" + ids.environmentId);
}

async function estado() {
  const d = await gql(`query($p:String!,$s:String!,$e:String!){ deployments(first:3, input:{projectId:$p, serviceId:$s, environmentId:$e}){ edges{ node{ id status createdAt } } }
    variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: ids.projectId, s: ids.serviceId, e: ids.environmentId });
  console.log("Despliegues:", d.deployments.edges.map((x) => x.node.status + " " + x.node.createdAt).join(" | ") || "ninguno");
  console.log("Variables con valor:", Object.entries(d.variables).filter(([, v]) => v).map(([k]) => k).join(", "));
}

async function desplegar() {
  await gql(`mutation($s:String!,$e:String!){ serviceInstanceDeploy(serviceId:$s, environmentId:$e) }`, { s: ids.serviceId, e: ids.environmentId });
  console.log("Despliegue pedido");
}

// Lee DISCORD_BOT_TOKEN de Railway solo en memoria para comprobar mensajes en #agent (nunca lo imprime).
async function verAgent() {
  const d = await gql(`query($p:String!,$s:String!,$e:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`, { p: ids.projectId, s: ids.serviceId, e: ids.environmentId });
  const tok = d.variables.DISCORD_BOT_TOKEN;
  if (!tok) return console.log("Sin DISCORD_BOT_TOKEN");
  const r = await fetch("https://discord.com/api/v10/channels/1557585826810962102/messages?limit=10", { headers: { authorization: "Bot " + tok } });
  const a = await r.json();
  if (!Array.isArray(a)) return console.log("Discord:", r.status, JSON.stringify(a).slice(0, 200));
  for (const m of a) console.log(m.timestamp, "|", (m.content || "").split("\n")[0].slice(0, 120));
}

const [cmd, arg] = process.argv.slice(2);
const fn = { crear, estado, desplegar, agent: verAgent, region: async () => {
  await gql(`mutation($s:String!,$e:String!,$i: ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }`,
    { s: ids.serviceId, e: ids.environmentId, i: { multiRegionConfig: { [arg]: { numReplicas: 1 } } } });
  console.log("Región cambiada a", arg);
} }[cmd || "crear"];
fn().catch((e) => { console.error("Error:", e.message); process.exit(1); });
