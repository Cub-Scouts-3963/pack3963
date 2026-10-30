(() => {
  "use strict";

  const SUPABASE_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get("token_hash") || "";
  const type = params.get("type") || "";
  const requestedNext = params.get("next") || "";
  const destinations = {
    "/family-account.html": { storageKey: "pack3963-family-account-session", label: "Family Account" },
    "/treasurer.html": { storageKey: "pack3963-treasurer-session", label: "Treasurer Portal" }
  };
  const destination = destinations[requestedNext] ? requestedNext : "";
  const config = destinations[destination];
  const allowedTypes = new Set(["signup", "magiclink"]);
  const heading = document.querySelector("#auth-confirm-heading");
  const status = document.querySelector("#auth-confirm-status");
  const spinner = document.querySelector("#auth-confirm-spinner");
  const returnLink = document.querySelector("#auth-confirm-return");

  function fail(message) {
    spinner.hidden = true;
    heading.textContent = "This sign-in link cannot be used";
    status.textContent = message;
    returnLink.href = destination || "/family-account.html";
    returnLink.hidden = false;
  }

  if (!tokenHash || !config || !allowedTypes.has(type)) {
    fail("The link is incomplete or invalid. Please return to the portal and request a new one-time sign-in link.");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      storage: window.sessionStorage,
      storageKey: config.storageKey,
      detectSessionInUrl: false,
      autoRefreshToken: true
    }
  });

  client.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => {
    if (error || !data.session) {
      fail("This one-time link may have expired or already been used. Please request a new sign-in email.");
      return;
    }
    history.replaceState({}, document.title, window.location.pathname);
    heading.textContent = `${config.label} verified`;
    status.textContent = "Your secure sign-in was successful. Redirecting now…";
    window.location.replace(destination);
  }).catch(() => {
    fail("We could not verify this link. Please return to the portal and request a new sign-in email.");
  });
})();
