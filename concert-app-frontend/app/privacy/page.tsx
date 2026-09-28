import type { Metadata } from "next";
import LegalDocument, { type LegalBlock } from "../components/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy · Afterset",
  description:
    "How Afterset collects, uses, and discloses information, and the choices available to you.",
};

// Copy is reproduced verbatim. The only change from the supplied text is
// that the service-provider links in Section 4 carry no tracking query
// string; the destinations and wording are unchanged.
const blocks: LegalBlock[] = [
  {
    kind: "p",
    text: "Afterset LLC (“Afterset,” “we,” “us,” or “our”) operates Afterset, a platform for discovering concerts, recording attendance, reviewing shows, and connecting with other concertgoers.",
  },
  {
    kind: "p",
    text: "This Privacy Policy explains what information we collect, how we use and disclose it, and the choices available to you.",
  },
  {
    kind: "p",
    text: "By using Afterset, you acknowledge the practices described in this Privacy Policy.",
  },

  { kind: "h2", text: "1. Information We Collect" },
  { kind: "h3", text: "Information You Provide" },
  {
    kind: "p",
    text: "When you create or use an Afterset account, we may collect information such as:",
  },
  {
    kind: "ul",
    items: [
      "your email address;",
      "your username or handle;",
      "your display name, if provided;",
      "your password, which is stored in hashed form rather than as plaintext;",
      "reviews, ratings, comments, and other content you submit;",
      "concerts you indicate that you attended;",
      "likes, follows, and other interactions with users or content;",
      "reports or other information you submit to us; and",
      "information you provide when contacting Afterset.",
    ],
  },
  {
    kind: "p",
    text: "You may also contribute information about concerts, artists, venues, or events.",
  },
  {
    kind: "p",
    text: "We do not currently collect payment information or require a date of birth.",
  },
  { kind: "h3", text: "Information Collected Automatically" },
  {
    kind: "p",
    text: "When you use Afterset, certain technical information may be processed automatically, including:",
  },
  {
    kind: "ul",
    items: [
      "IP address;",
      "browser and device information;",
      "request information and pages or features accessed;",
      "timestamps;",
      "diagnostic and error information; and",
      "information used to detect abuse, automated activity, or security threats.",
    ],
  },
  {
    kind: "p",
    text: "Some of this information may be processed temporarily rather than stored in Afterset's primary database.",
  },
  { kind: "h3", text: "Account and Security Information" },
  {
    kind: "p",
    text: "We maintain information necessary to operate and protect accounts, including email-verification and password-reset records, account status, moderation information, and security-related information.",
  },

  { kind: "h2", text: "2. Public Information" },
  {
    kind: "p",
    text: "Afterset is designed as a social platform. Certain information associated with your use of the service is public and may be viewed by people who do not have an Afterset account.",
  },
  { kind: "p", text: "Public information may include:" },
  {
    kind: "ul",
    items: [
      "your username or handle;",
      "your display name;",
      "your account join date;",
      "your reviews and ratings;",
      "your comments;",
      "concerts you indicate you attended;",
      "your follower and following counts; and",
      "engagement with content, such as likes.",
    ],
  },
  {
    kind: "p",
    text: "You should not include information in public content that you do not want others to see.",
  },
  {
    kind: "p",
    text: "Your email address, password information, verification and password-reset tokens, reports you submit, account moderation information, and certain administrative information are not displayed publicly.",
  },

  { kind: "h2", text: "3. How We Use Information" },
  { kind: "p", text: "We use information to:" },
  {
    kind: "ul",
    items: [
      "provide and operate Afterset;",
      "create and maintain user accounts;",
      "authenticate users and verify email addresses;",
      "enable reviews, comments, attendance records, follows, likes, and other social features;",
      "personalize and organize content;",
      "maintain our concert, artist, and venue database;",
      "send account-related and transactional communications;",
      "respond to questions and support requests;",
      "prevent spam, fraud, abuse, and unauthorized access;",
      "enforce our Terms of Service and community rules;",
      "investigate reports and moderate content;",
      "diagnose errors and improve the reliability and performance of Afterset;",
      "protect Afterset, our users, and others; and",
      "comply with legal obligations.",
    ],
  },
  {
    kind: "p",
    text: "We do not currently use personal information to serve targeted advertising.",
  },
  {
    kind: "p",
    text: "We do not currently sell personal information for monetary consideration.",
  },

  { kind: "h2", text: "4. Service Providers" },
  {
    kind: "p",
    text: "We use third-party service providers to operate Afterset. These providers may process information on our behalf as necessary to perform their services.",
  },
  { kind: "p", text: "These currently include:" },
  {
    kind: "ul",
    items: [
      {
        linkLabel: "Vercel",
        href: "https://vercel.com/",
        trailing: " for application hosting and infrastructure;",
      },
      {
        linkLabel: "Supabase",
        href: "https://supabase.com/",
        trailing: " for database infrastructure;",
      },
      {
        linkLabel: "Sentry",
        href: "https://sentry.io/",
        trailing: " for error and performance monitoring;",
      },
      {
        linkLabel: "Upstash",
        href: "https://upstash.com/",
        trailing: " for rate limiting and abuse prevention;",
      },
      {
        linkLabel: "Cloudflare",
        href: "https://www.cloudflare.com/",
        trailing: ", including Turnstile, for bot and abuse prevention; and",
      },
      {
        linkLabel: "Resend",
        href: "https://www.resend.com/",
        trailing: " for transactional email delivery.",
      },
    ],
  },
  {
    kind: "p",
    text: "For example, Cloudflare Turnstile processes browser and device signals in order to distinguish legitimate users from automated activity.",
  },
  {
    kind: "p",
    text: "We may change service providers as our infrastructure evolves.",
  },

  { kind: "h2", text: "5. Concert and Event Data" },
  {
    kind: "p",
    text: "Afterset obtains concert, artist, venue, and event information from multiple sources, which may include event platforms, venues, promoters, publicly available sources, and other data providers.",
  },
  {
    kind: "p",
    text: "When necessary to provide search or event-discovery functionality, search terms or similar requests may be sent to event-data providers. We do not intentionally provide those providers with your Afterset account credentials.",
  },
  {
    kind: "p",
    text: "Information supplied by third-party event sources is subject to change, and Afterset does not guarantee that third-party event information is complete or accurate.",
  },

  { kind: "h2", text: "6. Cookies and Local Storage" },
  {
    kind: "p",
    text: "Afterset currently uses browser storage to maintain your session and account state.",
  },
  {
    kind: "p",
    text: "For example, Afterset may store an authentication token and basic account information in your browser's local storage so that you can remain signed in and use authenticated features.",
  },
  {
    kind: "p",
    text: "We do not currently use advertising cookies or advertising pixels.",
  },
  {
    kind: "p",
    text: "If we introduce materially different tracking, advertising, or analytics practices, we will update this Privacy Policy and provide any notices or choices required by applicable law.",
  },

  { kind: "h2", text: "7. Transactional Emails" },
  {
    kind: "p",
    text: "We may send emails necessary to operate your account, including:",
  },
  {
    kind: "ul",
    items: [
      "email-verification messages;",
      "password-reset messages;",
      "account-deletion confirmations; and",
      "important security or service communications.",
    ],
  },
  {
    kind: "p",
    text: "We do not currently send marketing emails as part of the service.",
  },

  { kind: "h2", text: "8. Account Deletion and Retention" },
  {
    kind: "p",
    text: "You may request deletion of your Afterset account through the account-deletion functionality provided by the service.",
  },
  {
    kind: "p",
    text: "After requesting deletion, Afterset currently provides a 30-day grace period during which the deletion may be reversed.",
  },
  {
    kind: "p",
    text: "After that period, we remove identifying account information associated with your account, including information such as your email address, password credentials, display name, and other account identifiers.",
  },
  {
    kind: "p",
    text: "Certain contributions and activity may remain as part of Afterset's historical record, including reviews, comments, likes, and attendance records. Where retained, those contributions will no longer be displayed as belonging to your former account.",
  },
  {
    kind: "p",
    text: "We may also retain information when reasonably necessary to:",
  },
  {
    kind: "ul",
    items: [
      "protect the security and integrity of Afterset;",
      "prevent fraud or abuse;",
      "resolve disputes;",
      "enforce agreements;",
      "comply with legal obligations; or",
      "maintain legitimate business records.",
    ],
  },
  {
    kind: "p",
    text: "Retention periods may vary depending on the type of information and the reason it is maintained.",
  },

  { kind: "h2", text: "9. Security" },
  {
    kind: "p",
    text: "We use administrative and technical measures designed to protect information from unauthorized access, loss, misuse, or alteration.",
  },
  {
    kind: "p",
    text: "These measures include protections such as password hashing, access controls, rate limiting, bot protection, restricted database access, and monitoring.",
  },
  {
    kind: "p",
    text: "No system can guarantee absolute security, and users are responsible for maintaining the confidentiality of their account credentials.",
  },

  { kind: "h2", text: "10. Children" },
  {
    kind: "p",
    text: "Afterset is intended for users who are 13 years of age or older.",
  },
  {
    kind: "p",
    text: "If you are under 13, you may not create an account or use Afterset.",
  },
  {
    kind: "p",
    text: "We do not knowingly collect personal information from children under 13. If we learn that we have collected personal information from a child under 13, we will take appropriate steps to remove the information and terminate the account.",
  },
  {
    kind: "p",
    text: "If you believe a child under 13 has provided personal information to Afterset, contact us at support@afterset.fm.",
  },

  { kind: "h2", text: "11. Your Choices and Privacy Rights" },
  {
    kind: "p",
    text: "You may update certain account information through Afterset and may request deletion of your account.",
  },
  {
    kind: "p",
    text: "Depending on where you live, applicable law may provide additional rights regarding your personal information, such as rights to request access, correction, deletion, or information about how your data is used.",
  },
  {
    kind: "p",
    text: "To make a privacy request, contact support@afterset.fm.",
  },
  {
    kind: "p",
    text: "We may need to verify your identity before fulfilling certain requests.",
  },

  { kind: "h2", text: "12. International Users" },
  {
    kind: "p",
    text: "Afterset is operated from the United States, and our service providers and infrastructure may process information in the United States and other countries.",
  },
  {
    kind: "p",
    text: "If you access Afterset from outside the United States, your information may be transferred to and processed in countries whose data-protection laws differ from those in your country.",
  },

  {
    kind: "h2",
    text: "13. Disclosures Required by Law and Business Transfers",
  },
  {
    kind: "p",
    text: "We may disclose information if we reasonably believe doing so is necessary to:",
  },
  {
    kind: "ul",
    items: [
      "comply with applicable law, regulation, legal process, or governmental request;",
      "protect the rights, safety, or property of Afterset, our users, or others;",
      "investigate fraud, abuse, security incidents, or violations of our Terms; or",
      "establish, exercise, or defend legal claims.",
    ],
  },
  {
    kind: "p",
    text: "If Afterset is involved in a merger, acquisition, financing, reorganization, sale of assets, or similar transaction, information may be transferred as part of that transaction.",
  },

  { kind: "h2", text: "14. Changes to This Privacy Policy" },
  {
    kind: "p",
    text: "We may update this Privacy Policy as Afterset evolves.",
  },
  {
    kind: "p",
    text: "If we make material changes, we may provide notice through the service, by email, or through another reasonable method. The effective date above indicates when this Privacy Policy was last updated.",
  },

  { kind: "h2", text: "15. Contact Us" },
  {
    kind: "p",
    text: "For questions or requests concerning this Privacy Policy or your information:",
  },
  {
    kind: "address",
    lines: [
      "Afterset LLC",
      "c/o Northwest Registered Agent LLC",
      "418 Broadway, Ste N",
      "Albany, NY 12207",
      "United States",
    ],
  },
  { kind: "email", prefix: "Email: ", address: "support@afterset.fm" },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Afterset Privacy Policy"
      effectiveDate="Effective Date: September 27, 2026"
      blocks={blocks}
    />
  );
}
