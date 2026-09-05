import React from "react";
import LegalPage, { Section } from "./LegalPage";

export default function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="6 September 2026"
      path="/privacy"
      description="How Kanda POS collects, uses and protects data for the businesses and customers using our restaurant and retail point of sale platform."
    >
      <Section heading="Who this applies to">
        <p>
          Kanda POS is point-of-sale software used by restaurants and retail stores ("businesses"). This
          policy covers two groups of people: the business owners and staff who use Kanda POS to run their
          store, and the end customers of those businesses whose data passes through the system: for
          example, someone placing a delivery order or joining a loyalty programme.
        </p>
        <p>
          Each business's data belongs to that business. Kanda POS processes it on the business's behalf
          and does not sell it or use it to advertise to anyone.
        </p>
      </Section>

      <Section heading="What we collect">
        <p><strong>From business owners and staff:</strong> name, role, a hashed version of your 4-digit
          PIN (we store a one-way hash, never the PIN itself, so we cannot read it back), login activity,
          and any content you enter into the system: menu items, prices, schedules, and similar
          configuration.</p>
        <p><strong>From end customers of a business:</strong> name, phone number, order history, delivery
          address where relevant, loyalty points and birthday (if the business runs a loyalty programme),
          and messages exchanged through SMS or WhatsApp order updates.</p>
        <p><strong>Payment data:</strong> card and UPI payments are handled directly by Razorpay, our
          payment processor. We receive the outcome of a payment (success, amount, order reference) but
          never see or store full card numbers.</p>
        <p><strong>Usage data:</strong> we use PostHog to understand how the product is used: page views,
          clicks, and session recordings of the on-screen interface, so we can find and fix problems. We
          use Sentry to capture error reports when something breaks. Neither tool is used for advertising.</p>
      </Section>

      <Section heading="How we use it">
        <ul className="list-disc pl-5 space-y-1">
          <li>To run the core product: taking orders, tracking inventory, printing tickets, processing
            payments, and generating reports for the business.</li>
          <li>To send order and delivery updates by SMS or WhatsApp when a business has that feature turned
            on.</li>
          <li>To bill the business for its Kanda POS subscription.</li>
          <li>To diagnose bugs and improve reliability, using the error and session data described above.</li>
          <li>To respond when you contact us for support.</li>
        </ul>
      </Section>

      <Section heading="Who we share it with">
        <p>We share data only with the service providers that make Kanda POS work, each bound to only use
          it to provide their service to us:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Razorpay:</strong> payment processing.</li>
          <li><strong>Twilio:</strong> SMS and WhatsApp delivery.</li>
          <li><strong>Google Cloud and MongoDB Atlas:</strong> hosting and database storage.</li>
          <li><strong>PostHog:</strong> product analytics and session recording.</li>
          <li><strong>Sentry:</strong> error monitoring.</li>
        </ul>
        <p>We do not sell personal data, and we do not share one business's data with another business.</p>
      </Section>

      <Section heading="How long we keep it">
        <p>We keep order, customer, and staff records for as long as a business's account is active, plus a
          reasonable period afterward for legal, tax, and dispute purposes. A business can ask us to delete
          its data after closing its account, subject to the records we're required to retain by law.</p>
      </Section>

      <Section heading="Your rights">
        <p>Depending on where you're located, you may have the right to ask for a copy of your data, ask us
          to correct or delete it, or object to certain processing. Staff and business owners can raise
          this directly with their account contact; end customers should contact the business they ordered
          from, since the business controls that data, or email us at the address below and we'll route it
          to the right place.</p>
      </Section>

      <Section heading="Children">
        <p>Kanda POS is a business tool and isn't directed at children. We don't knowingly collect personal
          data from anyone under 18, other than a customer's stated date of birth used only to send a
          loyalty birthday offer, where that feature is enabled.</p>
      </Section>

      <Section heading="Changes to this policy">
        <p>If we make a material change to how we handle data, we'll update the date at the top of this page
          and, where appropriate, notify business owners directly.</p>
      </Section>

      <Section heading="Contact">
        <p>Questions about this policy: <a href="mailto:connect@kandapos.com" style={{ color: "var(--pos-accent)" }}>connect@kandapos.com</a> or <a href="tel:+919000990209" style={{ color: "var(--pos-accent)" }}>+91 90009 90209</a>.</p>
      </Section>
    </LegalPage>
  );
}
