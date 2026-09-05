import React from "react";
import LegalPage, { Section } from "./LegalPage";

export default function TermsAndConditions() {
  return (
    <LegalPage
      title="Terms and conditions"
      updated="6 September 2026"
      path="/terms"
      description="The terms that govern use of the Kanda POS restaurant and retail point of sale platform."
    >
      <Section heading="Agreement">
        <p>These terms govern use of Kanda POS by the business that signs up for an account ("you") and the
          staff you authorise to use it. By creating an account or using the system, you agree to them.</p>
      </Section>

      <Section heading="The service">
        <p>Kanda POS is point-of-sale software for restaurants and retail stores: order taking, kitchen
          tickets, inventory, staff management, customer loyalty, and reporting, delivered as a hosted web,
          Android, and Windows application.</p>
      </Section>

      <Section heading="Accounts and staff access">
        <p>You're responsible for who you give a staff PIN to and for keeping that access appropriate to
          each person's role. Actions taken under a staff PIN are treated as actions of your business.
          Tell us promptly if you believe a PIN has been compromised.</p>
      </Section>

      <Section heading="Subscription and billing">
        <p>Access is billed on the plan you sign up for. If a subscription lapses, we allow a short grace
          period before restricting staff sign-in, so you have time to update billing without losing access
          mid-service. We'll tell you what that grace period is when you subscribe.</p>
        <p>Fees are non-refundable except where required by law or where we've agreed otherwise in
          writing.</p>
      </Section>

      <Section heading="Your data">
        <p>You own the data you put into Kanda POS: your menu, orders, customers, and reports. We process
          it to provide the service, as described in our <a href="/privacy" style={{ color: "var(--pos-accent)" }}>privacy policy</a>, and don't claim ownership of it.
          If you close your account, you can request an export or deletion of your data.</p>
      </Section>

      <Section heading="Acceptable use">
        <ul className="list-disc pl-5 space-y-1">
          <li>Don't use Kanda POS for anything unlawful, or to process payments for goods or services you're
            not licensed to sell.</li>
          <li>Don't attempt to access another business's data or bypass the system's security.</li>
          <li>Don't resell or sublicense access to the platform without our written agreement.</li>
        </ul>
      </Section>

      <Section heading="Availability">
        <p>We aim to keep Kanda POS available and responsive, and we design for offline resilience so a
          terminal keeps taking orders through a brief connectivity loss. We don't guarantee uninterrupted
          service: scheduled maintenance, third-party outages (payment processors, SMS/WhatsApp delivery,
          our cloud hosting provider), or events outside our control can affect availability.</p>
      </Section>

      <Section heading="Limitation of liability">
        <p>To the extent permitted by law, Kanda POS is provided without warranties beyond those we
          expressly state, and our liability for any claim arising from your use of the service is limited
          to the fees you paid us in the three months before the claim arose. We're not liable for indirect
          or consequential losses, such as lost profits from a service interruption.</p>
      </Section>

      <Section heading="Termination">
        <p>You can close your account at any time. We may suspend or terminate an account that breaches
          these terms, doesn't pay its subscription after the grace period, or poses a security risk to the
          platform or other businesses.</p>
      </Section>

      <Section heading="Changes to these terms">
        <p>We'll update the date at the top of this page when these terms change, and tell business owners
          directly about any change that materially affects their rights or obligations.</p>
      </Section>

      <Section heading="Governing law">
        <p>These terms are governed by the laws of India, and any dispute is subject to the exclusive
          jurisdiction of the courts of Hyderabad, Telangana.</p>
      </Section>

      <Section heading="Contact">
        <p>Questions about these terms: <a href="mailto:connect@kandapos.com" style={{ color: "var(--pos-accent)" }}>connect@kandapos.com</a> or <a href="tel:+919000990209" style={{ color: "var(--pos-accent)" }}>+91 90009 90209</a>.</p>
      </Section>
    </LegalPage>
  );
}
