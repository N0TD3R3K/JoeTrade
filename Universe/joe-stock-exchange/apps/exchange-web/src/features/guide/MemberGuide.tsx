import { BookOpen, Landmark } from "lucide-react";
import { useEffect, type ReactNode } from "react";

const chapters = [
  ["stocks", "1. What are stocks and how to trade"],
  ["crypto", "2. What are crypto and how to trade"],
  ["balances", "3. Disposable Balance, Assets and Frozen Assets explained"],
  ["transactions", "4. Transactions and Asset Transactions"],
  ["going-public", "5. Going Public, how to do joint ventures"],
  ["company-income", "6. Company updates, services, income and bank offers"],
] as const;

function Chapter({ index, children }: { index: number; children: ReactNode }) {
  const [id, title] = chapters[index];
  return (
    <section className="guide-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
      <a className="guide-top-link" href="#contents">
        Back to contents
      </a>
    </section>
  );
}

export function MemberGuide() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "JoeSE Member Guide — Joe Universe";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="guide-page">
      <a className="guide-skip" href="#guide-content">
        Skip to guide
      </a>
      <header className="guide-header">
        <a className="guide-brand" href="/" aria-label="JoeSE home">
          <span className="brand-gem">J</span>
          <strong>JOESE</strong>
          <span>Member guide</span>
        </a>
        <a className="guide-return" href="/">
          Back to exchange
        </a>
      </header>
      <main className="guide-shell" id="guide-content">
        <div className="guide-hero">
          <span className="guide-kicker">
            <BookOpen size={18} aria-hidden="true" /> THE JOESE HANDBOOK
          </span>
          <h1>
            Your guide to
            <br />
            the JoeSE economy.
          </h1>
          <p>
            Learn how to trade, move J$, understand your portfolio, and build a
            member-owned company in the Joe Universe.
          </p>
          <div className="guide-simulation">
            <Landmark size={22} aria-hidden="true" />
            <p>
              <strong>A fictional economy, shared by members.</strong> J$ and
              all JoeSE assets have no real-world value. You cannot buy J$ with
              real money or redeem it for external money, goods, services or
              prizes. Company checkout concerns fictional in-universe access
              only.
            </p>
          </div>
        </div>
        <div className="guide-layout">
          <nav
            className="guide-contents"
            id="contents"
            aria-label="Guide contents"
          >
            <h2>In this guide</h2>
            {chapters.map(([id, title]) => (
              <a href={`#${id}`} key={id}>
                {title}
              </a>
            ))}
            <p>
              Available to everyone. No sign-in is needed to read or share this
              page.
            </p>
          </nav>
          <div className="guide-article">
            <div className="guide-getting-started">
              <span className="guide-kicker">START HERE</span>
              <h2>One identity. One spendable balance.</h2>
              <p>
                Sign in to the exchange through JoeAuth. Your exchange
                membership is linked to your Joe Banking account, so both
                products use the same available J$. Signing in does not create a
                second balance or automatically grant operator access.
              </p>
              <p>
                Use the left navigation for Account Overview, Stock Listings and
                News. On a small screen, open navigation with the menu; your
                initials return to Account Overview. The <strong>Inbox</strong>{" "}
                holds incoming transactions and share offers;{" "}
                <strong>Guide</strong> brings you back here.
              </p>
            </div>

            <Chapter index={0}>
              <p>
                A stock is a share of a company's fictional JoeSE listing. A
                ticker is its short label: stock tickers have three letters,
                such as <strong>JAI</strong>. Its displayed price is the current
                reference value of one share.
              </p>
              <h3>Place a stock order</h3>
              <ol className="guide-steps">
                <li>
                  Open <strong>Stock Listings</strong>, then{" "}
                  <strong>Equities</strong> in the listings panel and select a
                  company. Read its profile, price chart and Joe Wire news.
                </li>
                <li>
                  In the <strong>Order ticket</strong>, choose{" "}
                  <strong>Buy</strong> or <strong>Sell</strong> and enter a
                  positive whole number of shares, such as 1 or 10.
                </li>
                <li>
                  Check your disposable J$ for a buy, or your freely tradable
                  stock holdings for a sale. The estimate uses the reference
                  price; the actual quote and fee can make the final amount
                  different.
                </li>
                <li>
                  Select <strong>Open buy order</strong> or{" "}
                  <strong>Open sell order</strong>. This submits the order
                  immediately. Read the result before submitting again.
                </li>
                <li>
                  Check your portfolio and Banking balance. A completed purchase
                  adds shares; a completed sale adds net J$. An open order may
                  wait for a compatible order, or fill only part of its
                  quantity.
                </li>
              </ol>
              <h3>Quotes, fees and timing</h3>
              <p>
                The buy quote is slightly above the reference price and the sell
                quote slightly below it. The standard quote spread is 0.5% in
                total. A trading fee of <strong>0.25% on each side</strong> also
                applies, rounded to the nearest J$0.01. The reference value
                shown in your portfolio is not a guaranteed sale price.
              </p>
              <p>
                A buy order reserves J$ in Banking while it waits; a sell order
                reserves the offered assets. Only a successful fill exchanges
                assets for J$. Neither Joe Banking nor the exchange promises to
                buy your holdings back.
              </p>
              <p>
                Follow the live market badge. The normal session runs every day
                in the New York afternoon and evening, with brief trading locks
                around hourly price updates. Orders cannot be opened while the
                market is closed or updating.
              </p>
              <div className="guide-note">
                <strong>
                  Stock holdings and founder shares behave differently.
                </strong>{" "}
                Ordinary stock holdings use the Order ticket. Frozen company
                shares under <strong>Shareholdings</strong> use a private{" "}
                <strong>Offer</strong>, explained in section 4. A newly launched
                company may have only frozen shares available.
              </div>
              <p>
                A stock is delisted after three consecutive daily closes below
                J$1. Its shares then have zero market value, with no automatic
                refund of the original contribution or purchase price.
              </p>
            </Chapter>

            <Chapter index={1}>
              <p>
                JoeSE crypto assets are simulated units listed in the{" "}
                <strong>Crypto</strong> group. They have four-letter tickers,
                such as <strong>CORN</strong>, and appear under{" "}
                <strong>Crypto holdings</strong> in your portfolio. They are not
                external cryptocurrency: there is no blockchain wallet, external
                deposit or withdrawal.
              </p>
              <ol className="guide-steps">
                <li>
                  In <strong>Stock Listings</strong>, select a listing in{" "}
                  <strong>Crypto</strong> and read its profile and price
                  history.
                </li>
                <li>
                  Choose <strong>Buy</strong> or <strong>Sell</strong> in the
                  Order ticket.
                </li>
                <li>
                  Enter a quantity with up to two decimal places, such as{" "}
                  <strong>0.25</strong> or <strong>1.50</strong>. The smallest
                  unit is <strong>0.01</strong>; extra decimal places are
                  rejected.
                </li>
                <li>
                  Check the estimate, then open the order. The same quote
                  spread, trading fees, Banking reservations and matching rules
                  apply as for ordinary stocks.
                </li>
              </ol>
              <p>
                You can sell only units you own that are not already reserved by
                another order. Changes in the displayed price do not put J$ into
                your account; net proceeds arrive only when a sale settles.
              </p>
            </Chapter>

            <Chapter index={2}>
              <p>
                Your portfolio separates spendable money from the estimated
                value of what you own.
              </p>
              <div
                className="guide-table-wrap"
                role="region"
                aria-label="Balance types"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Portfolio card</th>
                      <th>What it means</th>
                      <th>How it becomes spendable</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Disposable Balance</th>
                      <td>
                        Your transaction-account J$ in Joe Banking, minus active
                        wire and exchange-order holds.
                      </td>
                      <td>
                        Already available for a new trade, transaction or
                        confirmed company contribution.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Assets</th>
                      <td>
                        The current reference value of ordinary stock and crypto
                        holdings. The site labels this card{" "}
                        <strong>Asset value</strong>.
                      </td>
                      <td>
                        A matching buyer purchases your assets through an order.
                        Fees and the quote affect the proceeds.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Frozen Assets</th>
                      <td>
                        The current value of company shareholdings, including
                        shares you founded or acquired through a private offer.
                      </td>
                      <td>
                        Another member accepts your offer to buy an exact number
                        of shares. Unsold shares stay frozen.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <h3>Held money has not necessarily been spent</h3>
              <p>
                A pending outgoing transaction or buy order reduces your
                disposable balance immediately because the money is reserved. It
                may still be part of your posted bank balance. A declined wire
                or canceled unfilled order releases its unused hold. A settled
                purchase spends the corresponding amount.
              </p>
              <div className="guide-example">
                <h3>A founding contribution</h3>
                <p>
                  Alice starts with J$10,000 available. She confirms J$5,000 for
                  1,000 founder shares. Her disposable balance becomes J$5,000,
                  and the shares initially represent J$5,000 of frozen assets.
                  The contribution has become company capital; it is not a bank
                  deposit she can withdraw.
                </p>
                <p>
                  Later prices can change the frozen value. If Alice sells 100
                  shares to Bob, only those 100 shares move. The remaining 900
                  stay hers and stay frozen.
                </p>
              </div>
              <p>
                The simulated net position combines posted transaction J$
                (including held funds when available), asset values and frozen
                values, minus any displayed borrowing. It is a portfolio
                estimate, not a cash balance or a promise that every asset can
                be sold. Borrowing includes outstanding bank loan principal and
                accrued interest. Deposit funding remains unavailable.
              </p>
            </Chapter>

            <Chapter index={3}>
              <h3>Transactions: send J$ to another member</h3>
              <ol className="guide-steps">
                <li>
                  Open your portfolio and choose{" "}
                  <strong>New transaction</strong>.
                </li>
                <li>
                  Enter the receiver's exact username or school email, the J$
                  amount and a message explaining its purpose.
                </li>
                <li>
                  Select <strong>Send to inbox</strong>. Banking reserves the
                  J$; the receiver has not received it yet.
                </li>
                <li>
                  The receiver opens <strong>Inbox</strong> and chooses{" "}
                  <strong>Receive</strong> or <strong>Decline</strong>.
                  Receiving moves the J$ to their available balance; declining
                  releases the sender's hold.
                </li>
              </ol>
              <p>
                These are the same receiver-approved wires used by Joe Banking.
                There is no wire fee in the current system. A transaction moves
                J$ only: it does not assign company shares or request payment
                from another member.
              </p>
              <h3>Asset Transactions: sell frozen shares to a named member</h3>
              <p>
                In this version, an asset transaction is a private share offer.
                The seller starts it from <strong>Shareholdings</strong>; the
                buyer cannot take shares or debit an owner without an offer.
              </p>
              <ol className="guide-steps">
                <li>
                  In your portfolio, find the company under{" "}
                  <strong>Shareholdings</strong> and select{" "}
                  <strong>Offer</strong>.
                </li>
                <li>
                  Enter the buyer's exact username or school email, a whole
                  number of available frozen shares, and the{" "}
                  <strong>Total asking price</strong> for the entire bundle.
                  This is not a price per share.
                </li>
                <li>
                  Review your net proceeds and the buyer's full debit, including
                  the 0.25% fee on each side. Select{" "}
                  <strong>Send private offer</strong>. The shares are reserved,
                  but no sale proceeds have arrived.
                </li>
                <li>
                  The named buyer opens <strong>Inbox</strong>, checks the
                  ticker, quantity and total debit, then chooses{" "}
                  <strong>Accept offer</strong> or <strong>Decline</strong>.
                </li>
                <li>
                  Acceptance settles the J$ and transfers exactly those shares.
                  The buyer receives frozen shareholdings; the seller receives
                  net disposable J$. Decline releases the seller's share
                  reservation without moving J$.
                </li>
              </ol>
              <div className="guide-example">
                <h3>Asking price is the bundle total</h3>
                <p>
                  For an offer of 100 shares at a total asking price of{" "}
                  <strong>J$1,000</strong>, the buyer pays{" "}
                  <strong>J$1,002.50</strong> and the seller receives{" "}
                  <strong>J$997.50</strong>. The buyer gets 100 shares, not
                  J$1,000 of disposable money.
                </p>
              </div>
              <p>
                There is no free share-gift option in the current offer form,
                and the bank cannot redeem frozen shares. Ordinary stock and
                crypto sales use the Order ticket instead.
              </p>
            </Chapter>

            <Chapter index={4}>
              <p>
                Going public creates a company listing that other members can
                see. The current launch form has one founder, who receives the
                initial frozen shares. A joint venture is built by agreeing on
                the project together, launching it, and using member share
                offers to allocate ownership.
              </p>
              <h3>Launch a listing</h3>
              <ol className="guide-steps">
                <li>
                  Agree on the project, its developer, the proposed ownership
                  split and the J$ each person will pay. Keep a written record
                  of the agreed share counts and whether quoted amounts include
                  fees.
                </li>
                <li>
                  Open the listings panel and select{" "}
                  <strong>+ Add Listing</strong>. Enter a unique three-letter
                  stock ticker, company name, description, HTTPS project URL,
                  founding contribution and whole number of shares.
                </li>
                <li>
                  The founder needs at least{" "}
                  <strong>J$5,000 of disposable balance</strong>. Select{" "}
                  <strong>Submit for review</strong>. Submitting does not move
                  money.
                </li>
                <li>
                  An operator reviews the proposal. Staff can also prepare a
                  proposal for you, but they cannot confirm your contribution on
                  your behalf.
                </li>
                <li>
                  Return to{" "}
                  <strong>+ Add Listing → Your listing requests</strong>. When
                  approved, check the exact contribution and share count, tick
                  the confirmation box and select{" "}
                  <strong>Fund &amp; launch</strong>.
                </li>
              </ol>
              <p>
                At launch, Banking records the contribution as company capital
                and the founder receives the specified frozen shares. The new
                company does not automatically create a separate public float or
                a second set of shares for partners.
              </p>
              <h3>
                Build a joint venture using transactions and asset transactions
              </h3>
              <p>
                Use a normal <strong>transaction</strong> for a separately
                agreed J$ contribution, reimbursement or other cash transfer.
                Use an <strong>asset transaction</strong> when J$ is being
                exchanged for a specific ownership stake. The two actions have
                different effects.
              </p>
              <div className="guide-note">
                <strong>
                  Use the private offer for the share purchase payment.
                </strong>{" "}
                Accepting it already debits the buyer and credits the seller.
                Sending a separate wire for that same purchase, then accepting a
                full-price offer, pays twice. A wire by itself does not reserve
                or guarantee any shares.
              </div>
              <div className="guide-example">
                <h3>Example: Alice 70%, Bob 30%</h3>
                <ol className="guide-steps">
                  <li>
                    Alice launches a company with J$5,000 and 1,000 frozen
                    shares. Initially she owns all 1,000.
                  </li>
                  <li>
                    Alice and Bob agree that Bob will acquire 300 shares for a
                    total asking price of J$1,500.
                  </li>
                  <li>
                    Alice uses <strong>Offer</strong> to send Bob exactly 300
                    shares at that bundle price. Bob accepts in his Inbox,
                    paying J$1,503.75 including his fee. Alice receives
                    J$1,496.25 after her fee.
                  </li>
                  <li>
                    Alice now holds 700 shares and Bob 300: a 70/30 split. All
                    1,000 remain frozen shareholdings. Each member checks their
                    portfolio and Banking activity.
                  </li>
                </ol>
              </div>
              <p>
                This member sale reimburses Alice for part of her stake; it does
                not add another J$1,500 to the company's original capital. The
                sale price is agreed between the members and need not equal the
                reference value.
              </p>
              <p>
                If partners choose to send contributions before launch, record
                that arrangement explicitly. The initial shares still go only to
                the founder. The current system has no automatic split, escrow,
                refund agreement or link between an earlier wire and a later
                share offer. Free allocation and simultaneous multi-founder
                funding are not implemented.
              </p>
              <p>
                Project duties and website permissions are agreed separately.
                Holding shares does not automatically grant a console role,
                project access or a guaranteed payment.
              </p>
            </Chapter>
            <Chapter index={5}>
              <h3>Posts and My Company</h3>
              <p>
                Open Posts to read company updates. A developer or member with
                settled ordinary or frozen shares can select that company and
                publish a title and update. A pending share offer does not grant
                publishing permission. You can withdraw your own post, or delete
                its title and body, even after selling your shares. Console
                operators can moderate posts.
              </p>
              <p>
                My Company lists your developed companies and settled company
                interests. Reports show weekly and lifetime revenue, refunds,
                employee payments, operating cash, verified locked founding
                capital, share market value and shareholder quantities. An
                unavailable earlier weekly close stays unavailable. Owning
                shares gives access to aggregate reports, while service, receipt
                and employee management belong to the registered company
                manager.
              </p>
              <h3>Company services and employee payments</h3>
              <p>
                A developer initializes company banking without moving founding
                capital. The manager requests approval for the service’s JoeAuth
                app, then creates a server-priced purchase or subscription plan.
                A service checkout link opens Account Overview with the exact
                company, price, payment terms and recurring interval. Read those
                terms and check the consent box to authorize a payment. A link
                alone cannot debit J$.
              </p>
              <p>
                Manage subscriptions in Account Overview or Joe Banking’s Loans
                section. Cancel future charges there. An insufficient-funds
                renewal becomes past due and needs your explicit retry; missed
                charges are not stacked automatically. Full refunds come from
                company operating cash and may remain pending if that company
                lacks funds.
              </p>
              <p>
                Managers configure the share of net service revenue assigned to
                employees and invite employees with exact allocation weights. An
                employee accepts the displayed pool and allocation in Account
                Overview. A funded closed-week payroll moves company operating
                cash to employees; stock ownership alone does not automatically
                earn an employee payment. Founding capital remains locked.
                Revenue does not directly rewrite share prices.
              </p>
              <h3>Weekly income tax and redistribution</h3>
              <p>
                A New York week runs Monday midnight through the following
                Monday. Tax applies to posted wages and deposit interest, plus
                net realized trading gains after costs and fees. Trading losses
                offset that week’s gains, not wages. Transfers, loan principal,
                opening grants, redistribution and unrealized share values are
                excluded.
              </p>
              <p>
                The selected rate applies to the whole taxable income: up to
                J$500 is 0%; over J$500 to J$2,000 is 2%; over J$2,000 to
                J$3,500 is 3%; over J$3,500 to J$5,000 is 5%; above J$5,000 is
                10%. These brackets have jumps at their thresholds. J$1,000
                wages plus J$600 realized gain gives J$1,600 income and J$32
                tax.
              </p>
              <p>
                Your weekly statements appear in Account Overview. Unknown
                historical costs hold an assessment for evidence review.
                Collection uses available cash and leaves unpaid tax on the
                statement; it does not spend held funds or force a sale.
                Reviewed corrections can refund excess tax. Redistribution needs
                an approved, actually funded bank budget and eligible members;
                it is not a guaranteed allowance.
              </p>
              <h3>Bank offers and rate news</h3>
              <p>
                An operator may offer a loan from the approved bank catalog.
                Read its principal, term, fixed or variable weekly rate and
                expiry in Account Overview or Joe Banking’s Loans page. Cash and
                interest begin only after you explicitly accept the exact terms.
                Repayments pay accrued interest first, then principal. A
                variable offer may need refreshing if the starting rate changes
                before acceptance. There are no automatic late fees or forced
                sales in this version.
              </p>
              <p>
                Applied Joe Rate changes appear in News with their actual
                effective time and operation reference. A cut adds a mild
                bullish model signal; an increase adds a mild bearish one.
                Prices still follow the bounded market engine, so a bulletin
                does not guarantee a return. Scheduled or canceled operations do
                not appear as applied news.
              </p>
              <p>
                Discussion is a planned destination. Its separate posting and
                moderation details are still being designed; listing-specific
                comments remain available in Stock Listings.
              </p>
            </Chapter>
            <footer className="guide-footer">
              <p>
                Need to make a transaction? Return to the exchange and use your
                own portfolio and Inbox. If a settlement remains pending
                unexpectedly, keep its details and ask an operator before
                submitting a replacement.
              </p>
              <a className="guide-return" href="/">
                Back to exchange
              </a>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
