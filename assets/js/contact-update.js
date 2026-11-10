(() => {
  "use strict";
  const client = window.supabase.createClient("https://buvrqioskjjhszqkpypa.supabase.co", "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V", { auth: { persistSession: true, storage: window.sessionStorage, storageKey: "pack3963-family-account-session", detectSessionInUrl: true, autoRefreshToken: true } });
  const form = document.querySelector("#contact-update-form");
  const status = document.querySelector("#contact-update-status");
  const setStatus = (message, kind = "") => { status.textContent = message; status.className = "family-status" + (kind ? " is-" + kind : ""); };
  const load = async () => {
    const { data } = await client.auth.getSession();
    if (!data.session) { setStatus("Please open this page from the Family Account portal and sign in first.", "error"); form.querySelector("button").disabled = true; }
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const { data, error } = await client.rpc("submit_contact_update_request", { proposed: values });
    if (error) { setStatus(error.message, "error"); return; }
    form.reset();
    setStatus("Thanks. Your update was submitted for Pack leadership review.", "success");
    form.querySelector("button").disabled = true;
    console.info("Contact update request submitted", data);
  });
  client.auth.onAuthStateChange(() => load());
  load();
})();