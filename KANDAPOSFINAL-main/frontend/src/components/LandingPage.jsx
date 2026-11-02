import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import "@fontsource/outfit/900.css";
import useSeo, { useStructuredData } from "../hooks/useSeo";
import initShop from "./landing/shopBehaviour";
import "./landing/landing-shop.css";

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Kanda POS",
      "url": "https://kandapos.com",
      "logo": "https://kandapos.com/kanda-logo.png",
      "email": "connect@kandapos.com",
      "telephone": "+91-90009-90209",
      "areaServed": { "@type": "Country", "name": "India" },
    },
    {
      "@type": "SoftwareApplication",
      "name": "Kanda POS",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, Android, Windows",
      "description": "GST-ready point of sale software for restaurants and retail stores in India: dine-in, collection, delivery and in-store sales, kitchen tickets, barcode checkout, staff, inventory and reporting in one system. Available now.",
      "url": "https://kandapos.com",
      "areaServed": "IN",
    },
  ],
};

export default function LandingPage() {
  useSeo({
    title: "Point of sale for restaurants & retail in India",
    description: "Kanda POS is a GST-ready point of sale for Indian restaurants and retail stores: dine-in, collection, delivery and in-store sales, kitchen tickets, barcode checkout, staff, inventory and reporting in one connected system. Available now — book a demo and we'll set up your store.",
    path: "/",
  });
  useStructuredData("ld-landing", STRUCTURED_DATA);

  const rootRef = useRef(null);
  useEffect(() => initShop(rootRef.current), []);

  const [form, setForm] = useState({ name: "", email: "", phone: "", business: "", city: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Public, unauthenticated lead-capture endpoint — no tenant/auth context
  // on the marketing homepage, so this bypasses the shared `api` client
  // (which resolves a tenant slug and attaches a staff token) in favor of a
  // plain fetch straight to the backend.
  const submitLead = async (payload) => {
    const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      // FastAPI 422s carry a list of field errors, not a string.
      const msg = typeof detail?.detail === "string" ? detail.detail : null;
      throw new Error(msg || "Something went wrong. Please try again.");
    }
    return res.json().catch(() => ({}));
  };

  const submitDemo = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!form.name.trim() || !form.email.trim()) {
      setError("Please fill in your name and email.");
      return;
    }
    setBusy(true);
    try {
      await submitLead({ type: "demo", ...form });
      setSubmitted(true);
      toast.success("Thanks! Our team will reach out to schedule your demo.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kshop" ref={rootRef} data-testid="landing-page">
      <div className="shutter" id="shutter" role="button" tabIndex="0" aria-label="Roll up the shutter and open the shop">
        <div className="board" aria-label="Kanda, point of sale">
          <img className="bm" src="/kanda-mark.png" alt="" aria-hidden="true" />
          <div><div className="t">KANDA<span>.</span></div><div className="s">POINT OF SALE</div></div>
        </div>
        <div className="graffiti">Shutter's going up. Your counter's about to get faster.</div>
        <div className="lock"><i></i><b></b><i></i></div>
      </div>


      <header>
        <nav className="wrap nav" aria-label="Main">
          <a className="logo" href="#top"><img src="/kanda-logo.png" alt="Kanda, point of sale" width="127" height="36" style={{ height: "36px", width: "auto", display: "block" }} /></a>
          <div className="links"><a href="#till">Try the till</a><a href="#kitchen">Kitchen</a><a href="#day">A day</a><a href="#menu">Features</a><a href="#contact">Contact</a></div>
          <div className="acts">
            <Link className="signin" to="/dashboard/login">Sign in</Link>
            <a className="pill o" href="#contact">Book a demo</a>
          </div>
        </nav>
      </header>

      <main id="top">
  
        <section className="hero" id="till">
          <div className="wrap">
            <div className="hero-top">
              <div>
                <h1>Point of sale, built for India's <em>busiest</em> counters.</h1>
              </div>
              <div>
                <p className="lead">Billing, kitchen, delivery and stock on one screen, with GST worked out on every bill. Available now, made in Hyderabad.</p>
                <div className="ctas"><a className="pill k" href="#contact">Book a demo</a><a className="pill l" href="#kitchen">See the kitchen</a></div>
              </div>
            </div>

            <div className="tryme" aria-hidden="true">
              <svg width="46" height="40" viewBox="0 0 46 40"><path d="M4 6 C 20 4, 34 12, 36 32" fill="none" stroke="#C2410C" strokeWidth="2.4" strokeLinecap="round"/><path d="M28 26 L36 34 L42 24" fill="none" stroke="#C2410C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Go on, ring up an order. It's the real flow.
            </div>

            <div className="counter">
              <div className="till">
                <div className="till-bar">
                  <div className="store"><b>Demo Restaurant, Banjara Hills</b></div>
                  <div className="seg" role="group" aria-label="Order type">
                    <button type="button" data-ot="Dine in" aria-pressed="true">Dine in</button>
                    <button type="button" data-ot="Takeaway" aria-pressed="false">Takeaway</button>
                    <button type="button" data-ot="Delivery" aria-pressed="false">Delivery</button>
                  </div>
                </div>
                <div className="till-body">
                  <div className="menu">
                    <div className="cats" id="cats" role="group" aria-label="Menu category"></div>
                    <div className="tiles" id="tiles"></div>
                  </div>
                  <div className="bill">
                    <div className="bill-h"><b id="billTitle">Table 4 · #142</b><span id="itemCount" style={{ color: "var(--muted)", fontSize: "14px" }}>0 items</span></div>
                    <div className="lines" id="lines"></div>
                    <div className="sums">
                      <div><span>Subtotal</span><span id="sSub">₹0.00</span></div>
                      <div><span>CGST 2.5%</span><span id="sC">₹0.00</span></div>
                      <div><span>SGST 2.5%</span><span id="sS">₹0.00</span></div>
                      <div><span>Round off</span><span id="sR">₹0.00</span></div>
                      <div className="tot"><span>Total</span><span id="sT">₹0</span></div>
                    </div>
                    <div className="bill-acts">
                      <button type="button" className="b-kot" id="bKot">Send KOT</button>
                      <button type="button" className="b-pay" id="bPay">Print bill</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="printer" aria-live="polite">
                <div className="pr-body"><div className="led"><i id="led" className="on"></i><span id="ledTxt">READY</span></div><div className="brandp">KANDA</div><div className="slot"></div></div>
                <div className="paper" id="paper"><div className="rcpt" id="rcpt"></div></div>
                <div className="pr-hint" id="prHint">Hit “Print bill” and watch this.</div>
              </div>
            </div>
          </div>
        </section>

  
        <section className="kitchen" id="kitchen">
          <div className="wrap">
            <div className="sec-h">
              <h2>Fire to the kitchen.</h2>
              <p>Orders land on the right station the second they're sent. Timers go amber, then red, before a guest has to ask. Tap Bump once it's out of the pass. Anything you sent from the till above is up here too.</p>
            </div>
            <div className="rail-wrap"><div className="rail" id="rail"></div></div>
            <div className="rail-foot">
              <div><b id="kOpen">0</b>on the rail</div>
              <div><b id="kDone">0</b>sent out</div>
              <div><b id="kAvg">—</b>average wait</div>
            </div>
          </div>
        </section>

  
        <section className="day" id="day" aria-label="A day at the counter">
          <div className="stick">
            <div className="sky" id="sky"></div>
            <canvas className="stars" id="stars" aria-hidden="true"></canvas>
            <div className="orb" id="orb" aria-hidden="true"></div>
            <svg className="city" id="city" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
              <g id="cityFill" fill="#2a2018">
                <rect x="0" y="190" width="1440" height="70"/>
                <rect x="30" y="150" width="90" height="110"/><rect x="130" y="120" width="70" height="140"/><rect x="210" y="160" width="110" height="100"/>
                <rect x="330" y="135" width="60" height="125"/><rect x="400" y="170" width="90" height="90"/>
          
                <rect x="560" y="120" width="240" height="140"/>
                <rect x="560" y="100" width="240" height="22"/>
                <rect x="548" y="40" width="22" height="220"/><rect x="790" y="40" width="22" height="220"/>
                <rect x="544" y="70" width="30" height="6"/><rect x="786" y="70" width="30" height="6"/>
                <rect x="544" y="110" width="30" height="6"/><rect x="786" y="110" width="30" height="6"/>
                <ellipse cx="559" cy="40" rx="13" ry="16"/><ellipse cx="801" cy="40" rx="13" ry="16"/>
                <rect x="557" y="14" width="4" height="14"/><rect x="799" y="14" width="4" height="14"/>
                <ellipse cx="680" cy="102" rx="26" ry="18"/>
                <rect x="840" y="150" width="80" height="110"/><rect x="930" y="125" width="70" height="135"/><rect x="1010" y="165" width="120" height="95"/>
                <rect x="1140" y="140" width="70" height="120"/><rect x="1220" y="115" width="80" height="145"/><rect x="1310" y="160" width="130" height="100"/>
              </g>
              <path id="arch" d="M640 260 V190 Q680 140 720 190 V260 Z" fill="#FFCF7A" opacity="0"/>
              <g id="windows" fill="#FFD27A" opacity="0">
                <rect x="50" y="170" width="12" height="16"/><rect x="85" y="200" width="12" height="16"/><rect x="150" y="140" width="10" height="14"/><rect x="172" y="180" width="10" height="14"/>
                <rect x="240" y="180" width="14" height="16"/><rect x="280" y="210" width="14" height="16"/><rect x="350" y="155" width="10" height="14"/><rect x="430" y="190" width="14" height="16"/>
                <rect x="860" y="170" width="12" height="16"/><rect x="950" y="150" width="10" height="14"/><rect x="972" y="200" width="10" height="14"/><rect x="1040" y="185" width="14" height="16"/>
                <rect x="1090" y="215" width="14" height="16"/><rect x="1160" y="160" width="10" height="14"/><rect x="1240" y="140" width="12" height="16"/><rect x="1270" y="200" width="12" height="16"/><rect x="1350" y="185" width="14" height="16"/>
              </g>
            </svg>
            <div className="wrap inner">
              <div>
                <p className="intro">Keep scrolling and watch a whole day go past.</p>
                <div className="clock" id="clock">07:00</div>
              </div>
              <div className="moment" id="moment">
                <div className="when" id="mWhen">07:00 – 09:00</div>
                <h3 id="mTitle">Chai rush</h3>
                <p id="mBody">Fifty Irani chais before nine. Quick keys and saved favourites keep the queue moving.</p>
                <div className="stats">
                  <div><b id="stO">0</b><span>orders so far</span></div>
                  <div><b id="stS">₹0</b><span>taken so far</span></div>
                </div>
              </div>
            </div>
            <div className="wrap scrub">
              <div className="bar"><i id="scrubBar" style={{ width: "0%" }}></i></div>
              <div className="ticks"><span>07:00</span><span>13:30</span><span>17:00</span><span>20:45</span><span>23:30</span></div>
            </div>
          </div>
        </section>

  
        <section className="board-sec" id="menu">
          <div className="wrap">
            <div className="chalk">
              <div className="stamp">All in<br />one plan</div>
              <h2>Today's specials</h2>
              <div className="sub">Everything your counter needs, on one plan</div>
              <div className="cols" id="dishes"></div>
            </div>
          </div>
        </section>

  
        <section className="contact" id="contact">
          <div className="wrap contact-grid">
            <div>
              <h2>Let's open your counter.</h2>
              <p className="lead">We're a small team in Hyderabad. Tell us about your restaurant or shop and one of us will set up a walkthrough on your own menu.</p>
              <div className="reach">
                <div className="it"><b>connect@kandapos.com</b><button type="button" data-copy="connect@kandapos.com">copy</button></div>
                <div className="it"><b>+91 90009 90209</b><a href="https://wa.me/919000990209" target="_blank" rel="noopener noreferrer">WhatsApp us</a></div>
                <div className="it"><b>@kanda.pos</b><a href="https://www.instagram.com/kanda.pos" target="_blank" rel="noopener noreferrer">on Instagram</a></div>
              </div>
            </div>

            <div className="pad" id="pad">
              <div className="pad-top"></div>
              <div className="pad-h"><span>Kanda POS order pad</span><span>No. <b id="padNo">0143</b></span></div>
              <h3>Contact us</h3>
              <form id="leadForm" noValidate onSubmit={submitDemo}>
                <div className="fld"><label htmlFor="f-name">Name <i>*</i></label><input id="f-name" name="name" autoComplete="name" placeholder="Your name" required value={form.name} onChange={update("name")} /></div>
                <div className="fld"><label htmlFor="f-email">Email <i>*</i></label><input id="f-email" name="email" type="email" autoComplete="email" placeholder="Email address" required value={form.email} onChange={update("email")} /></div>
                <div className="fld"><label htmlFor="f-business">Business</label><input id="f-business" name="business" autoComplete="organization" placeholder="Business name" value={form.business} onChange={update("business")} /></div>
                <div className="fld two"><label htmlFor="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" autoComplete="tel" placeholder="Phone number" value={form.phone} onChange={update("phone")} /><label htmlFor="f-city">City</label><input id="f-city" name="city" autoComplete="address-level2" placeholder="City" value={form.city} onChange={update("city")} /></div>
                <div className="fld msg"><label htmlFor="f-message">Message</label><textarea id="f-message" name="message" rows={3} placeholder="What are you looking to solve?" value={form.message} onChange={update("message")}></textarea></div>
                <div className="send"><small>We usually reply the same day.</small><button className="stampbtn" type="submit" id="sendBtn" disabled={busy}>{busy ? "Sending…" : "Contact us"}</button></div>
              </form>
              <div className="err" id="err" role="alert">{error}</div>
              {submitted && (
                <div className="done" id="done">
                  <div><div className="rs">REQUEST RECEIVED</div><p id="doneTxt">We'll be in touch at {form.email} shortly.</p></div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot">
            <div>
              <a className="logo" href="#top" style={{ marginBottom: "14px", display: "flex" }}><img src="/kanda-mark.png" alt="" width="34" height="34" style={{ borderRadius: "8px", display: "block" }} /><span className="wm"><b style={{ color: "#fff" }}>KANDA<span style={{ color: "#F97316" }}>.</span></b><small>POINT OF SALE</small></span></a>
              <div style={{ maxWidth: "30ch" }}>Point of sale software for restaurants and retail, built in Hyderabad.</div>
              <button type="button" className="downbtn" id="downBtn">Pull the shutter down ↓</button>
            </div>
            <div><h4>Product</h4><a href="#till">Try the till</a><a href="#kitchen">Kitchen display</a><a href="#menu">Features</a></div>
            <div><h4>Company</h4><a href="#contact">Contact</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div>
            <div><h4>Reach us</h4><div>connect@kandapos.com</div><div>+91 90009 90209</div><div>Hyderabad, India</div></div>
          </div>
    
          <div className="copyr"><span>© 2026 Kanda Solutions Pvt Ltd. All rights reserved.</span><span>Prices in ₹ · GST invoices by default</span></div>
        </div>
      </footer>

      <div className="toast" id="toast" role="status"></div>
    </div>
  );
}
