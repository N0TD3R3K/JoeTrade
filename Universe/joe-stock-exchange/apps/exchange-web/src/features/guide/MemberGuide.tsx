import { BookOpen, Landmark } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { bankSiteUrl } from "../../../../../../shared/economy/links";

const chapters = [
  ["start", "1. Your account and navigation"],
  ["balances", "2. Cash, assets and bank debt"],
  ["transactions", "3. Transactions and private share offers"],
  ["stocks", "4. Stock and crypto trading"],
  ["going-public", "5. Going public and joint ventures"],
  ["company-income", "6. Using My Company"],
  ["payments", "7. Purchases, subscriptions and refunds"],
  ["circulation", "8. Income, tax and money circulation"],
  ["banking", "9. Bank reserves and the Joe Rate"],
  ["loans", "10. Loans and repayment"],
  ["deposits", "11. Deposits: current availability"],
  ["community", "12. News, Posts and Discussion"],
  ["help", "13. Receipts, mistakes and getting help"],
] as const;
function Chapter({ index, children }: { index: number; children: ReactNode }) {
  const [id, title] = chapters[index];
  return (
    <section className="guide-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
      <a className="guide-top-link" href="#contents">Back to contents</a>
    </section>
  );
}
function Table({ label, headings, rows }: { label: string; headings: string[]; rows: string[][] }) {
  return (
    <div className="guide-table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table>
        <thead><tr>{headings.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map(([name, ...cells]) => (
          <tr key={name}><th scope="row">{name}</th>{cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
export function MemberGuide() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "JoeSE Member Guide — Joe Universe";
    return () => { document.title = previousTitle; };
  }, []);
  return (
    <div className="guide-page">
      <a className="guide-skip" href="#guide-content">Skip to guide</a>
      <header className="guide-header">
        <a className="guide-brand" href="/" aria-label="JoeSE home">
          <span className="brand-gem">J</span><strong>JOESE</strong><span>Member guide</span>
        </a>
        <a className="guide-return" href="/account">Back to exchange</a>
      </header>
      <main className="guide-shell" id="guide-content">
        <div className="guide-hero">
          <span className="guide-kicker"><BookOpen size={18} aria-hidden="true" /> THE MEMBER HANDBOOK</span>
          <h1>Your place in<br />the Joe economy.</h1>
          <p>A practical guide to JoeSE, Joe Banking, company ownership and the J$ that connects them.</p>
          <div className="guide-simulation">
            <Landmark size={22} aria-hidden="true" />
            <p><strong>Everything here belongs to a fictional economy.</strong>
              J$ has no real-world value. You cannot buy it with real money or redeem it for outside money,
              goods, services, prizes or cryptocurrency. Company checkout is for fictional in-universe access.
            </p>
          </div>
        </div>
        <div className="guide-layout">
          <nav className="guide-contents" id="contents" aria-label="Guide contents">
            <h2>In this guide</h2>
            {chapters.map(([id, title]) => <a href={`#${id}`} key={id}>{title}</a>)}
            <p>Public and shareable. Reading this guide does not require signing in.</p>
          </nav>
          <div className="guide-article">
            <div className="guide-getting-started">
              <span className="guide-kicker">CURRENT RELEASE</span>
              <h2>One identity. One spendable balance.</h2>
              <p>JoeAuth identifies you. Joe Banking records your cash. JoeSE records your listings,
                holdings and trades. A purchase in either product uses the same available J$.</p>
              <p>Loan offers work only when the bank has approved products and a lending budget.
                The new application and penalty design is awaiting approval. Deposit funding and
                Discussion posting are not available yet. Their sections below explain these limits.</p>
            </div>

            <Chapter index={0}>
              <p>Use your JoeAuth identity to sign in when the live service is connected. Membership,
                account linking and operator permissions are reviewed separately; signing in does not
                give someone staff access or another opening balance.</p>
              <p>The intended starting balance is a once-only J$10,000 grant for a reviewed eligible
                member. Existing accounts need their earlier grant checked rather than receiving it again.
                Alice and Bob are fictional local test accounts whose existing balances are kept.</p>
              <Table label="Member navigation" headings={["Section", "What you can do"]} rows={[
                ["Account Overview", "Compare disposable cash, holdings, held money and debt. Open transactions and Inbox; manage payments, bank offers and employee agreements."],
                ["Stock Listings", "Search stocks and crypto, read profiles and charts, place orders and use + Add Listing."],
                ["News", "Read published Joe Wire articles and effective bank-rate bulletins."],
                ["Posts", "Read company updates. Eligible developers and settled shareholders can publish."],
                ["Discussion", "A planned place for general opinions. Posting is not enabled yet."],
                ["My Company", "View companies you established or hold frozen company shares in. Ordinary market investments do not qualify."],
              ]} />
              <p>On smaller screens, open the menu for navigation. In Stock Listings, <strong>Browse listings</strong>
                opens the listing drawer and <strong>View portfolio</strong> opens your holdings panel.
                On a wide screen the portfolio is already visible. Your initials return to Account Overview.</p>
              <p>Open <strong>Guide</strong> to return here. Hover over a statistic's <strong>?</strong>
                button for an explanation; keyboard users can focus it, and touch users can tap it.
                Escape or a tap elsewhere dismisses the explanation.</p>
            </Chapter>

            <Chapter index={1}>
              <Table label="Balance definitions" headings={["Figure", "Meaning", "How you can use it"]} rows={[
                ["Disposable balance", "Shared bank transaction cash after active holds.", "Available for a new wire, payment, trade or confirmed founding contribution."],
                ["Held J$", "Cash reserved for pending outgoing wires or buy orders; still part of posted cash.", "It cannot fund another payment. An unfilled cancellation or declined wire releases the unused hold."],
                ["Asset value", "Reference value of ordinary stock and simulated crypto holdings.", "It becomes cash only when a sale actually settles with a buyer."],
                ["Frozen assets", "Reference value of frozen company shareholdings.", "Sell an exact quantity through a private offer accepted by a named member. The bank does not buy them back."],
                ["Bank loan debt", "Outstanding loan principal plus accrued interest already recorded.", "Repay from available transaction cash. An offer you have not accepted creates no debt."],
                ["Simulated net position", "Posted cash including held funds, plus ordinary and frozen assets, minus loan debt.", "A portfolio estimate; it is not a spendable balance or guaranteed sale price."],
              ]} />
              <div className="guide-example">
                <h3>Borrowing does not make you richer</h3>
                <p>If J$100 of loan cash arrives, both your cash and your debt increase by J$100.
                  Before interest, those changes cancel out in net position. Repaying principal reduces
                  both cash and debt. Paying interest reduces cash without adding an asset.</p>
              </div>
              <p>A displayed gain from a rising share price has not paid J$ into your bank. Company
                operating cash, locked founding capital, member holdings and bank reserves are separate
                figures. Adding them all together can count the same economic value more than once.</p>
            </Chapter>

            <Chapter index={2}>
              <h3>Send J$ to another member</h3>
              <ol className="guide-steps">
                <li>Open <strong>New transaction</strong> in JoeSE, or <strong>Transaction</strong> in Joe Banking.</li>
                <li>Enter the receiver's exact username or school email, an amount with at most two decimal places,
                  and a message explaining the transfer.</li>
                <li>Send it to the receiver's Inbox. Your cash is held immediately; the receiver has not been paid yet.</li>
                <li>The named receiver chooses <strong>Receive</strong> or <strong>Decline</strong>.
                  Receive transfers the cash; Decline releases the sender's hold.</li>
              </ol>
              <p>Pending wires can be canceled by their sender through Joe Banking. A completed wire
                cannot be canceled like an unaccepted one. There is no wire fee, payment-request feature
                or automatic reversal. Agree a return transfer or ask an operator about a recorded mistake.</p>
              <h3>Sell frozen shares through a private offer</h3>
              <ol className="guide-steps">
                <li>Under <strong>Shareholdings</strong>, choose <strong>Offer</strong> for your company.</li>
                <li>Identify the buyer, enter an exact whole quantity of available frozen shares, and enter
                  the <strong>total asking price for the bundle</strong>, not a per-share price.</li>
                <li>Review the buyer's total debit and your net proceeds. Sending reserves the shares;
                  it does not credit you any sale cash.</li>
                <li>The named buyer reviews the offer in Inbox and accepts or declines. Acceptance
                  exchanges exactly those shares and the J$, with a 0.25% fee on each side.</li>
              </ol>
              <div className="guide-example">
                <h3>Example: 100 shares for J$1,000</h3>
                <p>The buyer pays J$1,002.50 and receives 100 frozen shares. The seller receives J$997.50.
                  The buyer does not receive J$1,000 in disposable cash. Unsold shares stay frozen.</p>
              </div>
              <p>A normal wire moves cash only; it does not transfer ownership. A private share offer
                already includes its payment, so sending a separate wire for the same purchase would
                pay twice. Pending offers do not make the buyer a shareholder. Free share gifts are
                not supported by the current form.</p>
            </Chapter>

            <Chapter index={3}>
              <p>A stock is a unit in a fictional company listing. Stocks have three-letter tickers,
                such as JAI. Read its profile, price history and news before deciding what to do.
                Price movements are part of the simulation and do not guarantee gains.</p>
              <ol className="guide-steps">
                <li>In <strong>Stock Listings</strong>, select a listing under <strong>Equities</strong> or <strong>Crypto</strong>.</li>
                <li>In the order ticket choose Buy or Sell. Stocks use whole shares; simulated crypto
                  allows two decimal places, with a minimum unit of 0.01.</li>
                <li>Check your available cash or unreserved holdings, quantity and estimated value.</li>
                <li><strong>Open buy order</strong> or <strong>Open sell order</strong> submits immediately.
                  Read the result before submitting again.</li>
                <li>A matched fill exchanges cash and assets. An unmatched or partially filled order
                  stays open until filled or canceled. Only an unfilled remainder can be canceled.</li>
              </ol>
              <p>The standard quote spread is 0.5% in total, with the buy quote above and sell quote
                below the reference price. A fee of 0.25% on each side also applies, rounded to a cent.
                The displayed chart price is a reference, not a guaranteed execution price or bank redemption offer.</p>
              <p>Open buy orders hold cash; open sell orders reserve assets. Cancellation releases
                the unfilled portion, while completed fills remain final. A company with only frozen
                founder shares uses private offers rather than the ordinary Sell ticket.</p>
              <p>The authenticated exchange API supports order cancellation. The current member site
                has no order-history or cancellation panel; keep the order reference and ask an operator
                for help checking an open order. An opposite order does not cancel the first one.</p>
              <h3 id="crypto">Simulated crypto stays inside JoeSE</h3>
              <p>Crypto listings have four-letter tickers, such as CORN. These are fictional units,
                not outside cryptocurrency. There is no blockchain wallet, external deposit or withdrawal.
                The same matching, cash holds, fees and cancellation rules apply.</p>
              <h3>Market timing and delisting</h3>
              <p>The normal order session is daily in the New York afternoon and evening, with brief
                locks around hourly price updates. Follow the live market badge. Local testing may keep
                order entry open while the price engine still follows its normal hourly session.</p>
              <p>Prices incorporate the market model, trades and eligible news within movement caps.
                A stock closing below J$1 on three consecutive days is delisted: its shares have zero
                market value and founding or purchase costs are not automatically refunded.</p>
            </Chapter>

            <Chapter index={4}>
              <h3>Establish a company</h3>
              <ol className="guide-steps">
                <li>Use <strong>Stock Listings → + Add Listing</strong>. Provide a unique three-letter ticker,
                  company name, description, HTTPS project URL, contribution and whole share count.</li>
                <li>The founder needs at least J$5,000 disposable cash. Submit the proposal for operator
                  review; submission alone does not debit cash.</li>
                <li>After approval, return to <strong>Your listing requests</strong>, check the exact contribution
                  and shares, and explicitly confirm <strong>Fund &amp; launch</strong>.</li>
                <li>Funding records locked company capital and gives the founder the specified frozen shares.
                  The company becomes available in My Company.</li>
              </ol>
              <p>A staff-prepared proposal still requires the founder's consent. Launching does not
                automatically create public float, extra partner shares, company operating cash or website permissions.</p>
              <h3>Build a joint venture</h3>
              <p>Agree the project, duties, ownership split, quantities and fee treatment with your partners.
                The current launch accepts one founder. After launch, use private share offers to
                allocate ownership to other members. A wire can cover a separate contribution or reimbursement,
                but does not assign any shares.</p>
              <div className="guide-example">
                <h3>Alice 70%, Bob 30%</h3>
                <p>Alice contributes J$5,000 for 1,000 frozen shares. She offers Bob 300 shares for a
                  bundle price of J$1,500. If Bob accepts, he pays J$1,503.75 and Alice receives J$1,496.25.
                  Alice keeps 700 shares and Bob owns 300.</p>
                <p>The company still has the original J$5,000 of locked capital. Bob's payment went to
                  Alice for her shares, not into the company operating account.</p>
              </div>
              <p>There is no automatic multi-founder funding, free allocation, escrow or link between
                a preliminary wire and a later offer. Keep your agreement clear before anyone transfers J$.</p>
            </Chapter>

            <Chapter index={5}>
              <p><strong>My Company is for companies you established or own frozen company shares in.</strong>
                Ordinary stock-market purchases remain visible in Account Overview and Stock Listings;
                they do not unlock My Company statistics or private bank reports. A pending private
                offer also gives no access until its shares settle.</p>
              <p>Select a company to see market capitalization, weekly price change, service revenue,
                refunds, employee payouts, operating cash, locked founding capital and the shareholder table.
                The ? buttons explain each figure. A missing earlier weekly price is shown as unavailable.</p>
              <p>Market capitalization uses all outstanding ordinary and frozen shares at the reference price,
                including issuer inventory when present. The table shows member share quantities and their
                proportion of all outstanding shares. This is separate from the company's bank cash.</p>
              <h3>What the founder or registered manager can do</h3>
              <ol className="guide-steps">
                <li>Initialize company banking if needed. This identifies its operating account and proven
                  locked founding capital; it does not unlock or spend that capital.</li>
                <li>Request approval for a company service and its JoeAuth app. After operator approval,
                  create an exact-price purchase or recurring plan.</li>
                <li>Manage service plans, inspect payment receipts, and issue or retry a full service refund.</li>
                <li>Set the employee revenue pool, invite employees with allocation weights, and run funded
                  payroll for a closed revenue week.</li>
              </ol>
              <p>Other frozen shareholders can read aggregate reports and share quantities. They do
                not receive another manager's customer receipts, employee records or payment controls.
                Shares alone do not grant a staff role, an automatic dividend or access to project code.</p>
              <p>Service revenue adds company operating cash. Employee payments and refunds reduce it.
                Retained revenue stays with the company; it does not directly rewrite the stock price
                or become every shareholder's personal spendable cash.</p>
            </Chapter>

            <Chapter index={6}>
              <h3>Authorize a company payment</h3>
              <ol className="guide-steps">
                <li>Follow an approved service's checkout link to <strong>Account Overview → Banking activity</strong>.</li>
                <li>Read the named company, item, exact amount and terms. A recurring plan also shows its interval.</li>
                <li>Check the consent box and choose <strong>Authorize</strong>. A link alone cannot debit your J$.</li>
                <li>Keep the payment receipt/reference. Your cash and the company's funded revenue update after posting.</li>
              </ol>
              <p>Purchase means one payment. Subscription means an initial payment followed by the
                recurring amount you accepted. A newly created plan does not silently replace your accepted price.</p>
              <h3>Renewal, cancellation and failed payment</h3>
              <p>Recurring dates follow the New York time of your consent and the plan's calendar-day interval.
                Daylight-saving changes can make a calendar day 23 or 25 hours. Check the displayed next charge.</p>
              <p>Manage subscriptions in Account Overview, or in Joe Banking under Loans &amp; service payments.
                <strong>Cancel future charges</strong> prevents later renewals; it does not automatically refund
                an earlier payment. A renewal already posted before cancellation remains a completed payment.</p>
              <p>An unfunded renewal becomes <strong>past due</strong>. The system does not stack automatic
                charges for every missed interval. Add available cash and explicitly choose Retry payment,
                or cancel future charges. An active plan cannot be charged early with that retry button.</p>
              <h3>Refunds and service access</h3>
              <p>Ask the company manager about a mistaken service payment. The current refund is a full,
                linked refund funded from company operating cash. If the company cannot fund it, the
                refund remains pending; that status does not mean J$ has arrived. Partial refunds are not available.</p>
              <p>A payment receipt records the payment. The service also needs to recognize its approved
                receipt before granting access. If a paid service is still unavailable, keep the receipt
                and contact its manager rather than making a second purchase to try again.</p>
            </Chapter>

            <Chapter index={7}>
              <h3>Ways J$ moves through the system</h3>
              <Table label="Money circulation" headings={["Activity", "Where the cash goes"]} rows={[
                ["Reviewed opening grant", "Once-only opening cash is issued to an eligible new member. Existing grants must be reconciled."],
                ["Accepted bank loan", "Existing bank reserve cash moves to the borrower, with matching debt. Principal is not income."],
                ["Member trade or wire", "Existing cash moves between accounts. It does not issue a new opening grant."],
                ["Service purchase", "Member cash becomes company operating revenue."],
                ["Employee payroll", "Funded company operating cash moves to consenting employees."],
                ["Tax or loan repayment", "Paid cash returns to the bank reserve. Only the interest portion of loan repayment is bank interest income."],
                ["Redistribution", "An approved, actually funded bank distribution returns cash to eligible members."],
              ]} />
              <h3>Employees earn revenue payments</h3>
              <p>A manager chooses the fraction of net service revenue assigned to employees and each
                employee's share of that pool. Each employee must accept the displayed agreement.
                Accepted allocation weights must total 100% before payroll. Being a founder or shareholder
                does not automatically make someone an employee.</p>
              <p>Payroll uses a closed New York week and funded company operating cash. It cannot spend
                held member cash or locked founding capital. Underfunded payroll needs funding and retry;
                expected wages are not spendable cash until actually posted.</p>
              <h3>Weekly income tax</h3>
              <p>A New York week starts Monday at midnight. Taxable income includes posted wages,
                posted deposit interest if that product becomes available, and net realized stock,
                crypto and frozen-share gains after exact costs and fees. Trading losses offset
                that week's trading gains, not wages.</p>
              <p>Wires, loan principal, opening grants, redistribution and unrealized price changes
                are excluded. A share sale's entire proceeds are not its taxable gain.</p>
              <Table label="Weekly tax brackets" headings={["Taxable weekly income", "Rate on the whole amount"]} rows={[
                ["J$0–J$500", "0%"], ["Over J$500–J$2,000", "2%"],
                ["Over J$2,000–J$3,500", "3%"], ["Over J$3,500–J$5,000", "5%"],
                ["Over J$5,000", "10%"],
              ]} />
              <div className="guide-example"><h3>A whole-income bracket</h3>
                <p>J$1,000 of wages plus J$600 of net realized gains is J$1,600 taxable income.
                  The 2% bracket gives J$32 tax. These are whole-income brackets, so crossing a threshold
                  changes the rate for the full amount.</p>
              </div>
              <p>Read statements in Account Overview. Unknown historical costs hold an assessment for
                review. Collection uses available cash; it leaves unpaid amounts outstanding instead
                of spending held cash or forcing asset sales. Later evidence requires a reviewed
                correction; excess collected tax can be refunded.</p>
              <h3>Redistribution is conditional</h3>
              <p>Only an approved budget, actually received taxes and loan interest, reviewed eligible
                members, and sufficient reserve headroom can fund redistribution. Pending refunds must
                be covered first. It is an equal funded payment, not a guaranteed recurring allowance.</p>
            </Chapter>

            <Chapter index={8}>
              <p><a href={bankSiteUrl(window.location.hostname)}>Open Joe Banking</a> to see Account Balance,
                Transaction, Interest Rate, Deposits, Loans and Inbox. The same identity link and
                available balance connect it to JoeSE.</p>
              <p>The bank starts with J$100,000 of its own reserve cash. Below J$90,000 is a danger warning.
                This reserve is separate from member balances and company capital. Loan payments can
                return cash to it; unpaid interest and market-valued shares are not reserve cash.</p>
              <h3>Reading the weekly Joe Rate</h3>
              <p>The Joe Rate is quoted <strong>per week</strong>, not per year, and stays between
                0.300% and 2.000%. Check Banking → Interest Rate for the current approved value and history.
                A rate adjustment is a change of 0.005–0.200 percentage points in 0.005 steps,
                with at most two effective adjustments in a New York week.</p>
              <p>For example, moving from 1.000% to 0.995% is a decrease of 0.005 percentage points.
                A future operation can be canceled before execution. A change affects variable loan
                interest prospectively; accepted fixed terms keep their rate. It does not automatically
                credit interest to member transaction cash.</p>
              <p>Effective changes create a published bulletin. A cut adds a mild positive model signal
                for one eligible stock tick, and an increase adds a mild negative signal. Crypto is
                excluded from this particular signal. Price caps and other inputs still apply; a
                bulletin does not promise that every affected stock will move in that direction.</p>
              <p>The console's daily snapshot is due at New York noon. A late capture shows when it
                actually occurred. A provisional snapshot has not verified the shared cutoff; a
                reconciled snapshot has. Daily observations are not a live second-by-second total.
                Average assets are a monitoring figure, not a rule forcing everyone to hold J$10,000.</p>
            </Chapter>

            <Chapter index={9}>
              <div className="guide-note"><strong>Current offers and proposed rules are different.</strong>
                The bank already supports explicit loan offers and repayments. Products and a lending
                budget must be approved before offers can be made. A member application flow and
                overdue penalties are still a proposal; no proposed penalty applies to an existing loan.
              </div>
              <ol className="guide-steps">
                <li>An operator offers a product from the approved catalog. If none is enabled,
                  no member loan is currently available; ask the bank operator rather than a company manager.</li>
                <li>Open the offer in Account Overview → Banking activity or Joe Banking → Loans.
                  Read principal, weekly rate, fixed/variable type, term, expiry and repayment terms.</li>
                <li>Explicitly accept the exact displayed terms to receive reserve-funded cash,
                  or decline. No principal or interest begins merely because an offer exists.</li>
                <li>Repay from available transaction cash with the Repayment amount and Repay loan button.
                  Check the updated principal, interest and receipt.</li>
              </ol>
              <h3>What interest and repayment mean</h3>
              <p>Current loan interest is simple on outstanding principal and prorated for elapsed time.
                Unpaid interest is not itself principal for compounding. Fractional cents are carried
                until they become a whole cent. Early principal repayment reduces later interest.
                Each repayment pays accrued interest first, then principal; overpayment is rejected.</p>
              <p>A fixed loan keeps its accepted weekly rate. A variable loan follows the Joe Rate
                plus its accepted spread, split at actual effective rate changes. If the starting
                variable rate changes before acceptance, the bank must provide a refreshed offer.</p>
              <div className="guide-example"><h3>A simple loan example</h3>
                <p>At an unchanged 1.000% weekly rate, J$100 outstanding for seven complete days
                  accrues J$1 interest. A J$20 repayment then pays J$1 interest and J$19 principal,
                  leaving J$81 principal. Actual shorter intervals and rate changes alter the amount.</p>
              </div>
              <p>The displayed due date is not automatic forgiveness. Under the current engine,
                simple contractual interest continues while principal remains outstanding. There are
                no automatic late fees, forced asset sales or new penalty rates. If you cannot pay,
                contact an operator with the loan reference and an affordable proposed repayment plan.
                Reading access and your identity are not a form of collateral.</p>
            </Chapter>

            <Chapter index={10}>
              <div className="guide-note"><strong>Deposit funding is currently unavailable.</strong>
                Seeing a deposit catalog, a flexible-savings figure or the Joe Rate does not open
                a savings contract, lock money or earn a payment. Term maturity and deposit-interest
                posting are not active features.</div>
              <p>A future deposit would move existing J$ from disposable cash into a separate savings
                product. It would not accept outside money or create a real-world claim. Planned
                flexible deposits would permit withdrawal and use the variable Joe Rate; planned term
                deposits would lock principal and keep their accepted fixed weekly rate.</p>
              <Table label="Deposit catalog preview only" headings={["Planned term", "Preview fixed weekly rate"]} rows={[
                ["2 weeks", "1.000%"], ["4 weeks", "1.500%"], ["8 weeks", "2.250%"],
              ]} />
              <p>These are catalog previews, not available products or payment promises. Before deposit
                funding is released, members must be shown principal, withdrawal and maturity rules,
                interest method, reserve funding and exact accepted terms. Do not send a member wire
                expecting it to create a deposit or earn interest.</p>
            </Chapter>

            <Chapter index={11}>
              <h3>News: published information</h3>
              <p>News contains published console articles and effective bank-rate bulletins. Read the
                affected tickers, direction, severity and effective time. Scheduled or canceled rate
                operations are not reported as completed changes; internal operator notes stay private.</p>
              <h3>Posts: company updates</h3>
              <p>All members can read published Posts. A current developer or holder of settled
                ordinary stock or frozen company shares can publish about that specific company.
                Ordinary stock still gives this publishing permission even though it does not unlock
                My Company reports. Crypto and pending share offers do not qualify.</p>
              <ol className="guide-steps">
                <li>Open Posts and choose one of your eligible companies.</li>
                <li>Enter a plain-text title and progress update, then Publish update.</li>
                <li>Withdraw your post to hide it, or Delete post to remove its stored title and body.
                  You retain removal access to your own post even after selling the shares.</li>
              </ol>
              <p>Console operators can moderate posts. Deletion keeps an audit record of the action,
                not a copy of the deleted text. Check your wording before publishing and use removal
                controls carefully; the current interface has no restore action.</p>
              <h3>Discussion: planned, with listing comments available</h3>
              <p>The Discussion destination is reserved for all members' opinions, but its posting,
                threading and moderation rules have not been implemented. For the current listing-specific
                conversation, open Stock Listings → News &amp; discussion → Comments. Comments are separate
                from company Posts and can be moderated by operators.</p>
              <p>Keep updates accurate and respectful. Do not post passwords, identity tokens, private
                account information or someone else's personal details.</p>
            </Chapter>

            <Chapter index={12}>
              <h3>Check the state before trying again</h3>
              <p>Pending wire means reserved cash awaiting the receiver. Open order means the unfilled
                portion is still waiting. Past-due subscription means its renewal was not paid. Pending
                refund means the company has not yet returned the cash. A temporary settlement outage
                can require recovery even after one part completed.</p>
              <p>If an action times out, check Inbox, your holdings, Banking activity and the receipt
                first. Repeatedly creating a new transaction or checkout can create a second intended
                payment. Keep the reference, member, ticker/service, amount and approximate time and
                contact an operator when the outcome remains unclear.</p>
              <h3>Who can help?</h3>
              <p>Ask the receiver about a pending wire, the company manager about a service purchase
                or refund, and a bank/exchange operator about account access, settlements, tax evidence
                or loan terms. A guide explanation does not replace the exact terms shown on an offer.</p>
              <h3>Local testing</h3>
              <p>Alice/Bob switches are available only in the local test environment. The console's
                operator is separate from member trading. Demonstration records persist after reloads;
                switching accounts or signing in does not restore J$10,000 or erase debt. No password
                is needed for these synthetic test accounts.</p>
            </Chapter>
            <footer className="guide-footer">
              <p>Ready to continue? Use your own Account Overview and Inbox to check every cash or ownership change.</p>
              <a className="guide-return" href="/account">Open Account Overview</a>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
