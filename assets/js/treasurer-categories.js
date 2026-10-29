(() => {
  "use strict";
  const SB_URL = "https://buvrqioskjjhszqkpypa.supabase.co";
  const SB_KEY = "sb_publishable_I15v7OgXeqzJCCg-r7RwRw_ievTWP8V";
  const client = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, storage: window.sessionStorage, storageKey: "pack3963-treasurer-session", detectSessionInUrl: true, autoRefreshToken: true }
  });
  const state = { categories: [], access: null };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function setStatus(message, kind = "") {
    const element = $("#category-status");
    if (!element) return;
    element.textContent = message;
    element.className = "form-status" + (kind ? " is-" + kind : "");
  }

  function useLabels(category) {
    const labels = [];
    if (category.use_for_transactions) labels.push("Charges & payments");
    if (category.use_for_expenses) labels.push("Expenses");
    if (category.use_for_orders) labels.push("Orders");
    return labels.length ? labels.join(", ") : "Not assigned";
  }

  function categoriesFor(use) {
    const field = "use_for_" + use;
    return state.categories.filter(category => category.active && category[field]);
  }

  function populateSelects() {
    $$("[data-category-select]").forEach(select => {
      const current = select.value;
      const categories = categoriesFor(select.dataset.categorySelect);
      select.innerHTML = '<option value="">Choose a category</option>' +
        categories.map(category => `<option value="${esc(category.name)}">${esc(category.name)}</option>`).join("");
      if (categories.some(category => category.name === current)) select.value = current;
    });
  }

  function filteredCategories() {
    const query = ($("#category-search")?.value || "").trim().toLowerCase();
    const filter = $("#category-status-filter")?.value || "active";
    return state.categories.filter(category => {
      const statusMatch = filter === "all" || (filter === "active" ? category.active : !category.active);
      return statusMatch && (!query || [category.name, useLabels(category)].join(" ").toLowerCase().includes(query));
    });
  }

  function renderTable() {
    const body = $("#categories-table");
    if (!body) return;
    const rows = filteredCategories();
    body.innerHTML = rows.length ? rows.map(category => `
      <tr class="${category.active ? "" : "is-voided"}">
        <td><strong>${esc(category.name)}</strong></td>
        <td>${esc(useLabels(category))}</td>
        <td>${Number(category.sort_order)}</td>
        <td><span class="status-pill">${category.active ? "Active" : "Inactive"}</span></td>
        <td><div class="action-group">
          <button class="action-button" type="button" data-edit-category="${category.id}">Edit</button>
          <button class="action-button" type="button" data-toggle-category="${category.id}" data-active="${category.active ? "false" : "true"}">${category.active ? "Deactivate" : "Restore"}</button>
        </div></td>
      </tr>`).join("") : '<tr><td class="empty-row" colspan="5">No matching categories.</td></tr>';
  }

  function render() {
    populateSelects();
    renderTable();
  }

  async function loadCategories() {
    const result = await client.from("financial_categories").select("*").order("sort_order").order("name");
    if (result.error) throw result.error;
    state.categories = result.data || [];
    render();
  }

  function resetForm() {
    const form = $("#category-form");
    if (!form) return;
    form.reset();
    form.elements.category_id.value = "";
    form.elements.original_name.value = "";
    form.elements.sort_order.value = "100";
    $("#category-form-heading").textContent = "Add a category";
  }

  function openForm(category = null) {
    const form = $("#category-form");
    resetForm();
    if (category) {
      form.elements.category_id.value = category.id;
      form.elements.original_name.value = category.name;
      form.elements.name.value = category.name;
      form.elements.sort_order.value = category.sort_order;
      form.elements.use_for_transactions.checked = category.use_for_transactions;
      form.elements.use_for_expenses.checked = category.use_for_expenses;
      form.elements.use_for_orders.checked = category.use_for_orders;
      $("#category-form-heading").textContent = "Edit category";
    }
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveCategory(form) {
    const data = new FormData(form);
    const id = String(data.get("category_id") || "");
    const originalName = String(data.get("original_name") || "");
    const name = String(data.get("name") || "").trim();
    const payload = {
      name,
      sort_order: Number(data.get("sort_order") || 100),
      use_for_transactions: data.has("use_for_transactions"),
      use_for_expenses: data.has("use_for_expenses"),
      use_for_orders: data.has("use_for_orders"),
      updated_at: new Date().toISOString()
    };
    if (!payload.use_for_transactions && !payload.use_for_expenses && !payload.use_for_orders) {
      throw new Error("Choose at least one place where this category should be available.");
    }

    if (id) {
      if (name !== originalName) {
        const renamed = await client.rpc("rename_financial_category", { p_category_id: id, p_new_name: name });
        if (renamed.error) throw renamed.error;
      }
      const updated = await client.from("financial_categories").update(payload).eq("id", id);
      if (updated.error) throw updated.error;
    } else {
      const inserted = await client.from("financial_categories").insert(payload);
      if (inserted.error) throw inserted.error;
    }
  }

  async function init(session) {
    if (!session?.user || !$("#categories-table")) return;
    const access = await client.from("authorized_users").select("*")
      .eq("email", String(session.user.email || "").toLowerCase()).eq("active", true).maybeSingle();
    if (access.error || !access.data || !["admin", "treasurer"].includes(access.data.role)) return;
    state.access = access.data;
    await loadCategories();
  }

  $("#show-category-form")?.addEventListener("click", () => openForm());
  $("[data-close-category-form]")?.addEventListener("click", () => { $("#category-form").hidden = true; resetForm(); });
  $("#category-search")?.addEventListener("input", renderTable);
  $("#category-status-filter")?.addEventListener("change", renderTable);
  $("#category-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus("Saving category…");
    try {
      await saveCategory(event.currentTarget);
      event.currentTarget.hidden = true;
      resetForm();
      await loadCategories();
      setStatus("Category saved. All category lists are now updated.", "success");
    } catch (error) {
      setStatus(error.message || "Unable to save the category.", "error");
    } finally {
      button.disabled = false;
    }
  });
  $("#categories-table")?.addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-category]");
    if (edit) {
      const category = state.categories.find(item => item.id === edit.dataset.editCategory);
      if (category) openForm(category);
      return;
    }
    const toggle = event.target.closest("[data-toggle-category]");
    if (!toggle) return;
    toggle.disabled = true;
    try {
      const updated = await client.from("financial_categories").update({
        active: toggle.dataset.active === "true", updated_at: new Date().toISOString()
      }).eq("id", toggle.dataset.toggleCategory);
      if (updated.error) throw updated.error;
      await loadCategories();
      setStatus("Category status updated.", "success");
    } catch (error) {
      setStatus(error.message || "Unable to update the category.", "error");
      toggle.disabled = false;
    }
  });

  client.auth.getSession().then(({ data }) => init(data.session).catch(error => setStatus(error.message, "error")));
  client.auth.onAuthStateChange((_event, session) => {
    if (session) setTimeout(() => init(session).catch(error => setStatus(error.message, "error")), 0);
  });
})();
