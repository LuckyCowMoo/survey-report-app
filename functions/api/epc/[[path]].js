const EPC_UPSTREAM =
  "https://api.get-energy-performance-data.communities.gov.uk";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const rest = url.pathname.replace(/^\/api\/epc/, "") || "/";
  const target = `${EPC_UPSTREAM}/api${rest}${url.search}`;
  const auth = context.request.headers.get("Authorization");
  const headers = new Headers();
  headers.set(
    "Accept",
    context.request.headers.get("Accept") || "application/json"
  );
  if (auth) headers.set("Authorization", auth);
  return fetch(target, { method: context.request.method, headers });
}
