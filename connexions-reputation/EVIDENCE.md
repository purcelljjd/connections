# How GatherUp does review requests and AI replies: the evidence

Researched 2026-10-25. Every claim below points to a file in `evidence/` or a public URL. Where something could not be seen, it says so.

## 0. What could and could not be seen

- `https://app.gatherup.com/dashboard/business-wizard/onboarding` returns **HTTP 403** without a login. Body: `Access Denied by #[IsGranted("add_location")] on controller` (`evidence/onboarding-403-response.html`).
  - `#[IsGranted(...)]` is a Symfony (PHP) security attribute. The wizard is a server-rendered Symfony page that needs a logged-in user with the `add_location` permission.
  - Assets come from `cdn.reviewability.com` (GatherUp's sister brand). The login page ships only `assign.js` and `login/validation.js`. There is no public app bundle to read, unlike Elfsight.
- **Not seen:** the real wizard screens, GatherUp's actual SMS/email templates, and the AI prompt (that runs on their servers). Seeing the screens needs a GatherUp account login.
- **Seen instead:** GatherUp's own public setup guides, the public API reference at `app.gatherup.com/api/doc` (same backend), and their SmartReply / AutoReply product pages.

## 1. The onboarding wizard (business-wizard)

Source: `evidence/GatherUp-Quick-Start-Guide-v4.pdf`, pages 4 to 7 (GatherUp's "Set-Up Wizard").

1. **Business**: type the name as it appears on the Google Business Profile, with city and state. Then confirm the address, phone, website and business category.
   - Pro tip from the guide: these details are used for **SMS verification**. "Inaccurate or blank fields can lead to delays in your ability to send review requests via text message."
2. **Owner details**: also part of SMS verification.
3. **Authorize Google (GMB)**: lets them pull reviews more often and reply to Google reviews from inside GatherUp. Confirm with "Yes, that's correct!", then "Continue to Requests".
4. **Design the survey**: add a logo, pick an accent color ("choose a bold or dark color"), and toggle **NPS or Stars**.
5. **"Send Test and Finish."**

The API mirrors those fields (`evidence/api-docs/business_create.txt`):
- `/business/create` requires `businessName, businessType` (a Google business type), `streetAddress, city, state, zip, country, phone`.
- It optionally takes `businessOwnerAccount/Email/FirstName/LastName`, `emailLogo`, `feedbackBanner`, `websiteUrl` and `language`.
- Note from the docs: "New businesses will be billed within 24 hours of being added."

## 2. Review request flows ("Request Modes")

Source: Quick Start Guide pages 9 to 13, and `evidence/GatherUp-How-to-Start-Gathering-Feedback.pdf`.

| GatherUp name (old name) | Steps | What the customer gets |
|---|---|---|
| Survey & Reviews (Ultimate Mode) | 3 | Rating, then open-ended feedback, then "copy that feedback into a third-party review request" |
| Ratings & Reviews (Review Mode) | 2 | NPS or star rating, then a third-party or first-party review |
| Public Reviews (Direct Mode) | 1 | Straight to third-party review sites |

- **Positive page**: "displays for users that rate you positively and asks them to write a 3rd-party online review."
- **Negative page**: "offers an apology as well as a call to action to leave more direct feedback". It also still shows the review sites, "to be in compliance with the Federal Trade Commission's guidelines."
- **Threshold** that decides positive or negative: "NPS score of 7 or 3.5 stars by default", and it's adjustable. The API calls it `pageThreshold` (`business_update.txt`).
- Each mode keeps its own content, steps, ON/OFF toggles and "timing settings for automatic delays" (the reminders).
- **Review sites**: "select between 2 to 4 total." Added through `/business/online-review-link/add` with `type` (google, yelp, facebook...) and `link`.

## 3. How requests go out (email / SMS)

**Feedback Settings** (guide p.13, and the SMS blog post):
- Default send method: email, SMS or both.
- "Reminder Type for SMS Requests" makes SMS requests get SMS reminders. Earlier, reminders always went by email.
- 1st and 2nd reminders are toggled on per Request Mode.
- "Repeat customer thresholds" cap how often one person is asked.
- Each location gets 300 SMS credits.

**Send Mode** (guide p.14), set to Manual or Automatic:
- Automatic queues new customers "to be sent a review request during business hours", with a daily cap. In the API that's `/business/auto-feedback-requests`: `autoFeedback` 1 or 0, plus `autoSend` = "Amount of feedbacks per day".
- Their tip: "Do not send out all of your requests in one day... it creates a natural flow of reviews that can help prevent triggering filters of the online review sites."

**The actual send** (`customer_create.txt`, `customer_feedback_send.txt`):
- `/customer/create` takes `customerEmail`, `customerPhone`, `customerPreference` (`sms|email`), `customerTags` and `customerJobId`.
- `sendFeedbackRequest: 1` sends right away. `delayFeedbackRequest: N` delays it N hours (Manual mode only).
- `/customer/feedback/send`: "Request method depends on customer preferences." `checkThreshold: 1` refuses if the repeat threshold is reached.
- Error codes show the guardrails:
  - `12` Daily requests limit (100) exceeded
  - `54` SMS limit exceeded
  - `55` Invalid phone number
  - `57` "Customer has unsubscribed from your SMS messages"

**Other ways customers get the link** (Start Gathering PDF p.4): a per-location Feedback URL and QR code, Kiosk Mode, TextBack (text a keyword and get the link back), and a Feedback Locator for multi-location businesses.

## 4. How the AI reply is generated

| Feature | Source | What it does |
|---|---|---|
| **SmartReply** | `evidence/smartreply-page.html`, gatherup.com/blog/generate-review-responses-smartreply | Analyzes the review and drafts a customized reply. "SmartReply responses reference product descriptions or summaries and identify and match the sentiment." Uses OpenAI technology. Sometimes uses the customer's first name or calls out what they praised. "Always editable" and never posted without approval. One click to generate. Access is limited by user permission. Public beta Feb 2023. |
| **AutoReply** | gatherup.com/blog/review-management-ai-powered-autoreply-... | "Powered by ChatGPT's AI learning model"; generates and sends personalized replies to **positive** reviews. |
| **Suggested Responses** (beta) | same post, and Quick Start Guide p.16 | For **negative** reviews. "You'll get notified when a negative review gets posted," along with an AI-suggested reply. "With one click of a button, you can approve and send review replies from the notification in your email inbox." |

**Where replies get posted** (API):
- `/online-review/reply` with `reviewId` and `content`. "Feature works for reviews from google which are authorization by GMB." Error `77`: "OAuthConnection with GMB has been lost."
- `/customer/reply` replies to first-party feedback, with `visibility` (public or private) and `respondAsBusinessOwner`.
- `/online-reviews/get` returns each review's `reviewRating`, `reviewContent` and `reviewAuthor`, plus Google's `reviewGoogleAttributesPositive/Negative`. That is the input the AI works from.

**Inferred, not seen:** the reply pipeline is review text + rating + business profile/description, sent to an OpenAI model, which returns an editable draft. Positive replies auto-send (AutoReply), and negative ones go to a human for approval (Suggested Responses). The exact prompt is server-side and not public.

## 5. How Connexions Reputation maps to it

| GatherUp | Connexions Reputation |
|---|---|
| Set-Up Wizard (5 steps) | `#/onboarding`: Business, Owner, Review sites (with a Google Place ID link builder), Request design with live preview, Test & finish |
| Request Modes | Survey & Reviews / Ratings & Reviews / Public Reviews, same steps and same 7 / 3.5-star defaults |
| Feedback landing page | `feedback.html`: NPS or stars, routes by threshold, review links still shown on the negative page |
| Send Mode, daily cap, business hours | Manual or Automatic; Automatic sends 9am to 6pm up to N per day (needs the Connexions server for texts, or a webhook) |
| Repeat threshold, reminders 1 and 2, SMS reminders | Same settings; reminders stop once the customer responds or clicks a site |
| Email / SMS sending | Manual: opens your email or text app, pre-filled. **Connexions server: real texts through Twilio or Txtria, picked by `SMS_PROVIDER` in `server/.env`.** Webhook: POSTs each message to Zapier / Make. No automatic email sender yet. |
| SmartReply / AutoReply / Suggested Responses | `reply-engine.js`: built-in offline drafter, or Claude (your API key). Positive reviews auto-draft. **Nothing ever posts without your click** (stricter than AutoReply). |
| GMB review sync and direct reply | **Not built.** Paste reviews in. Approving a reply copies it and opens the review site. |
