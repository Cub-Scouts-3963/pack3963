const PORTAL_URL = "https://www.pack3963.com/treasurer.html";
const ROLES = {
  admin: { label: "Administrator", description: "You can manage Pack finances and decide who has access to the portal.", tasks: ["Record charges, payments, credits, orders, expenses, and receipts.", "Send family invoices and account emails, and review the email history.", "Add or update authorized users and their roles in Access."] },
  treasurer: { label: "Treasurer", description: "You can maintain Pack financial records. An administrator manages portal access.", tasks: ["Record charges, payments, credits, orders, expenses, and receipts.", "Send family invoices and account emails, and review the email history.", "Import reviewed roster or payment records and export account ledgers."] },
  viewer: { label: "View only", description: "You can review Pack financial information and account ledgers. You cannot change records, send emails, or manage access.", tasks: ["Review the dashboard, Scout and family balances, and transaction history.", "Open account ledgers and export them as CSV or print/save as PDF.", "Review recorded expenses, receipts, orders, and email history."] }
};
const GUIDE = [
  ["Dashboard", "Start with the Pack bank balance, balances due, credits, expenses, and reimbursements."],
  ["Scouts & accounts", "Find a Scout or family, filter the list, and select their name to open an itemized ledger. Family ledgers include linked Scouts."],
  ["Charges & payments", "Review what an account owes and the payments or credits applied to it."],
  ["Expenses & receipts", "Track Pack purchases, receipts, and reimbursements separately from Scout and family balances."],
  ["Orders", "Review shirts, camping, and outings, including quantities, sizes/options, due dates, and paid or unpaid status."],
  ["Family emails", "Find family invoices and account messages, along with the recorded sending status and history."]
];
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function invitationEmail(user, support = "cubscouts3963@gmail.com") {
  const role = ROLES[user.role];
  if (!role) throw new Error("Unsupported invitation role");
  const subject = "You're invited to the Pack 3963 Treasurer Portal";
  const greeting = user.display_name ? `Hello ${user.display_name},` : "Hello,";
  const intro = "A Pack 3963 administrator has given you access to our Treasurer Portal, the private workspace Pack leaders use to track Scout and family accounts and manage Pack finances.";
  const steps = [
    `Open the Treasurer Portal: ${PORTAL_URL}`,
    `Enter ${user.email} and select “Email me a sign-in link.” Use this invited email address each time.`,
    "Open the separate sign-in email and select its secure button. There is no password to create or remember."
  ];
  const signInHelp = "Your sign-in email includes its expiration time. If the link expires or has already been used, return to the portal and request a fresh one. Check spam or junk if it does not arrive.";
  const privacy = "This is a private leadership tool, not a parent payment page. It contains Scout, family, and financial information. Keep records confidential and sign out when using a shared computer. Opening this invitation does not sign you in or make a payment.";
  const unexpected = "If you were not expecting access, you do not need to sign in. Contact the Pack so an administrator can review the invitation.";
  const text = ["CUB SCOUT PACK 3963 — TREASURER PORTAL", "", greeting, "", intro, "", `YOUR ACCESS: ${role.label}`, role.description, ...role.tasks.map(t => "- " + t), "", "GET STARTED", ...steps.map((s, i) => `${i + 1}. ${s}`), "", signInHelp, "", "FIND YOUR WAY AROUND", ...GUIDE.map(([name, detail]) => `${name}: ${detail}`), "", privacy, "", unexpected, `Questions? Reply to this email or contact ${support}.`].join("\n");
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;background:#eef3f8;color:#243447;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your ${escape(role.label)} access is ready. Learn how to sign in and use the portal.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f8;"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="background:#004b8d;padding:22px 24px;border-bottom:6px solid #f7c600;color:#fff;"><img src="https://www.pack3963.com/assets/images/cubscoutlogo.png" width="170" alt="Cub Scout Pack 3963" style="display:block;width:170px;max-width:100%;height:auto;border:0;margin:0 auto 10px;"><div style="font-size:16px;font-weight:bold;">Treasurer Portal</div></td></tr>
<tr><td style="padding:26px 24px;font-size:16px;line-height:1.6;">
<p style="color:#b5161c;font-size:12px;font-weight:bold;letter-spacing:1px;margin:0;">YOUR PORTAL INVITATION</p>
<h1 style="color:#004b8d;font-size:28px;line-height:1.2;margin:10px 0 20px;">Welcome to the Treasurer Portal</h1>
<p>${escape(greeting)}</p><p>${escape(intro)}</p>
<div style="padding:16px;background:#f4f8fc;border-left:4px solid #004b8d;margin:20px 0;"><strong>Your access: ${escape(role.label)}</strong><p style="margin:6px 0 0;">${escape(role.description)}</p></div>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#f7c600;border-radius:6px;"><a href="${PORTAL_URL}" style="display:inline-block;color:#003f75;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 20px;">Open Treasurer Portal</a></td></tr></table>
<h2 style="color:#004b8d;font-size:21px;margin:28px 0 12px;">How to sign in</h2>
<ol style="padding-left:22px;">${steps.map(s => `<li style="margin-bottom:10px;overflow-wrap:anywhere;">${escape(s)}</li>`).join("")}</ol>
<p style="font-size:14px;color:#526474;">${escape(signInHelp)}</p>
<h2 style="color:#004b8d;font-size:21px;margin:28px 0 12px;">What you can do</h2>
<ul style="padding-left:22px;">${role.tasks.map(t => `<li style="margin-bottom:8px;">${escape(t)}</li>`).join("")}</ul>
<h2 style="color:#004b8d;font-size:21px;margin:28px 0 12px;">Find your way around</h2>
${GUIDE.map(([name, detail]) => `<p style="margin:0 0 16px;"><strong style="color:#004b8d;">${escape(name)}</strong><br>${escape(detail)}</p>`).join("")}
<div style="padding:16px;background:#f4f8fc;border-left:4px solid #b5161c;font-size:14px;">${escape(privacy)}</div>
<p style="font-size:14px;">${escape(unexpected)}</p><p style="font-size:14px;">Questions? Reply to this email or contact <a href="mailto:${escape(support)}" style="color:#004b8d;">${escape(support)}</a>.</p>
<p style="font-size:13px;color:#526474;">If the button does not work, open:<br><a href="${PORTAL_URL}" style="color:#004b8d;overflow-wrap:anywhere;">${PORTAL_URL}</a></p>
</td></tr><tr><td style="background:#003f75;color:#fff;padding:18px 24px;font-size:12px;">Cub Scout Pack 3963 · Chicago, Illinois</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
