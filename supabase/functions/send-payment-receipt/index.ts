import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

async function buildReceipt(payment: any, partner: any, invoices: any[], allocations: any[], creditBalance: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  const left = 48;
  let y = 785;
  const line = (text: string, isBold = false, size = 11) => {
    if (y < 70) {
      page = pdf.addPage([595.28, 841.89]);
      y = 785;
    }
    page.drawText(text.slice(0, 95), {
      x: left, y, size, font: isBold ? bold : font,
      color: rgb(0.12, 0.17, 0.22),
    });
    y -= size + 11;
  };
  const receiptNumber = String(payment.id).slice(0, 8).toUpperCase();
  line("iGO DELIVERY", true, 18);
  line("Partner payment receipt", true, 15);
  line("Receipt: PAY-" + receiptNumber, false);
  line("Partner: " + (partner.name || "Partner"), false);
  line("Email: " + (partner.email || ""), false);
  line("Transfer reference: " + (payment.reference_number || "—"), false);
  line("Payment date: " + (payment.transfer_date || "—"), false);
  line("Amount received: MVR " + Number(payment.verified_amount || 0).toFixed(2), true, 13);
  y -= 8;
  line("Invoices included", true, 13);
  const allocationByInvoice = new Map(allocations.map((a) => [a.invoice_id, Number(a.amount || 0)]));
  for (const invoice of invoices) {
    line(
      (invoice.invoice_number || "Invoice") +
      " · applied MVR " + (allocationByInvoice.get(invoice.id) || 0).toFixed(2) +
      " · remaining MVR " + Math.max(0, Number(invoice.subtotal || 0) - Number(invoice.paid_amount || 0)).toFixed(2)
    );
  }
  line("Available partner credit: MVR " + creditBalance.toFixed(2), true, 12);
  line("This receipt confirms the approved payment and invoice allocations shown above.", false, 9);
  return await pdf.save();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase function secrets are missing.");
    if (!resendKey || !fromEmail) throw new Error("Receipt email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Sign in as an admin to send a receipt." }, 401);
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: role, error: roleError } = await userClient.rpc("current_user_role");
    if (roleError || role !== "admin") return json({ error: "Only admins may send payment receipts." }, 403);
    const { paymentId } = await request.json();
    if (!paymentId) return json({ error: "Payment id is required." }, 400);

    const admin = createClient(url, serviceKey);
    const { data: payment, error: paymentError } = await admin.from("payments")
      .select("id,partner_id,status,amount,verified_amount,reference_number,transfer_date,invoice_ids,payment_allocations(invoice_id,amount)")
      .eq("id", paymentId).single();
    if (paymentError) throw paymentError;
    if (payment.status !== "confirmed") throw new Error("Only an approved payment can have a receipt.");

    const { data: partner, error: partnerError } = await admin.from("partners")
      .select("id,name,email").eq("id", payment.partner_id).single();
    if (partnerError) throw partnerError;
    if (!partner.email) throw new Error("This partner has no email address on their account.");

    const { data: previous } = await admin.from("payment_receipt_emails")
      .select("status,attempts").eq("payment_id", paymentId).maybeSingle();
    if (previous?.status === "sent") return json({ sent: true, alreadySent: true });

    const invoiceIds = Array.isArray(payment.invoice_ids) ? payment.invoice_ids : [];
    const { data: invoices, error: invoiceError } = await admin.from("invoices")
      .select("id,invoice_number,subtotal,paid_amount").in("id", invoiceIds);
    if (invoiceError) throw invoiceError;
    const allocations = payment.payment_allocations || [];
    const { data: ledger, error: creditError } = await admin.from("partner_credit_ledger")
      .select("amount").eq("partner_id", payment.partner_id);
    if (creditError) throw creditError;
    const creditBalance = (ledger || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const receipt = await buildReceipt(payment, partner, invoices || [], allocations, creditBalance);

    await admin.from("payment_receipt_emails").upsert({
      payment_id: paymentId, recipient: partner.email, status: "queued",
      attempts: Number(previous ? 1 : 0), last_error: null, updated_at: new Date().toISOString(),
    }, { onConflict: "payment_id" });

    const invoiceRows = (invoices || []).map((invoice: any) => {
      const applied = allocations.find((allocation: any) => allocation.invoice_id === invoice.id)?.amount || 0;
      const remaining = Math.max(0, Number(invoice.subtotal || 0) - Number(invoice.paid_amount || 0));
      return "<tr><td>" + escapeHtml(invoice.invoice_number) + "</td><td>MVR " +
        Number(applied).toFixed(2) + "</td><td>MVR " + remaining.toFixed(2) + "</td></tr>";
    }).join("");
    const amount = Number(payment.verified_amount || 0).toFixed(2);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: [partner.email],
          subject: "iGO payment receipt · MVR " + amount,
          html: "<div style='font-family:Arial,sans-serif;color:#172033;max-width:640px'>" +
            "<h1>iGO payment receipt</h1><p>Hello " + escapeHtml(partner.name) +
            ", your payment of <strong>MVR " + amount + "</strong> has been approved.</p>" +
            "<p>Reference: " + escapeHtml(payment.reference_number || "—") + "</p>" +
            "<table style='border-collapse:collapse;width:100%'><thead><tr><th align='left'>Invoice</th><th align='left'>Applied</th><th align='left'>Still due</th></tr></thead><tbody>" +
            invoiceRows + "</tbody></table><p>Available credit: <strong>MVR " +
            creditBalance.toFixed(2) + "</strong></p><p>Your itemized receipt is attached as a PDF.</p></div>",
          attachments: [{ filename: "iGO-payment-receipt.pdf", content: toBase64(receipt) }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.message || "Email provider rejected the receipt.");
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : "Email provider rejected the receipt.";
      await admin.from("payment_receipt_emails").upsert({
        payment_id: paymentId, recipient: partner.email, status: "failed",
        attempts: Number(previous?.attempts || 0) + 1,
        last_error: message.slice(0, 500), updated_at: new Date().toISOString(),
      }, { onConflict: "payment_id" });
      throw emailError;
    }

    await admin.from("payment_receipt_emails").upsert({
      payment_id: paymentId, recipient: partner.email, status: "sent",
      attempts: Number(previous?.attempts || 0) + 1,
      last_error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "payment_id" });
    return json({ sent: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not send payment receipt." }, 500);
  }
});
