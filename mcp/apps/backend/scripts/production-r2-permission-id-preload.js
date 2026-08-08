const EXPECTED_NAME = "Workers R2 Storage Read";
const VERIFIED_PERMISSION_ID = "b4992e1108244f5d8bfbd5744320c2e1";
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input?.url;
  if (rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {}
    if (
      parsed?.hostname.toLowerCase() === "api.cloudflare.com" &&
      (
        /^\/client\/v4\/accounts\/[a-f0-9]{32}\/tokens\/permission_groups$/i.test(parsed.pathname) ||
        parsed.pathname === "/client/v4/user/tokens/permission_groups"
      ) &&
      parsed.searchParams.get("name") === EXPECTED_NAME
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: VERIFIED_PERMISSION_ID,
              name: EXPECTED_NAME,
              scopes: ["com.cloudflare.api.account"]
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  }
  return originalFetch(input, init);
};
