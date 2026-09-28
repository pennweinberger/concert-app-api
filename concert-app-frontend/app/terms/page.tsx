import type { Metadata } from "next";
import LegalDocument, { type LegalBlock } from "../components/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Service · Afterset",
  description:
    "The terms governing your access to and use of Afterset, operated by Afterset LLC.",
};

// Copy is reproduced verbatim.
const blocks: LegalBlock[] = [
  {
    kind: "p",
    text: "These Terms of Service (“Terms”) govern your access to and use of Afterset, operated by Afterset LLC (“Afterset,” “we,” “us,” or “our”).",
  },
  {
    kind: "p",
    text: "By creating an account or otherwise using Afterset, you agree to these Terms and our Privacy Policy.",
  },
  { kind: "p", text: "If you do not agree, do not use Afterset." },

  { kind: "h2", text: "1. Eligibility" },
  {
    kind: "p",
    text: "You must be at least 13 years old to use Afterset.",
  },
  {
    kind: "p",
    text: "By creating an account, you represent that you meet this requirement and have the legal capacity to agree to these Terms.",
  },
  {
    kind: "p",
    text: "If you are using Afterset on behalf of an organization, you represent that you have authority to bind that organization to these Terms.",
  },

  { kind: "h2", text: "2. Your Account" },
  {
    kind: "p",
    text: "You are responsible for maintaining the confidentiality of your account credentials and for activity conducted through your account.",
  },
  {
    kind: "p",
    text: "You agree to provide accurate information and not to:",
  },
  {
    kind: "ul",
    items: [
      "impersonate another person or organization;",
      "create an account using information you are not authorized to use;",
      "sell, transfer, or improperly share access to your account; or",
      "use another person's account without permission.",
    ],
  },
  {
    kind: "p",
    text: "Notify us at support@afterset.fm if you believe your account has been compromised.",
  },
  {
    kind: "p",
    text: "We may suspend or restrict accounts when reasonably necessary to protect Afterset, enforce these Terms, investigate abuse, or comply with law.",
  },

  { kind: "h2", text: "3. The Afterset Service" },
  {
    kind: "p",
    text: "Afterset allows users to discover and interact with information about concerts, artists, and venues and to record and share their experiences.",
  },
  {
    kind: "p",
    text: "Features may include reviews, ratings, comments, attendance records, likes, follows, profiles, rankings, discovery tools, and other social or informational features.",
  },
  {
    kind: "p",
    text: "We may add, remove, modify, or discontinue features over time.",
  },

  { kind: "h2", text: "4. User Content" },
  {
    kind: "p",
    text: "“User Content” means content or information that you submit to Afterset, including reviews, ratings, comments, profile information, and information you contribute about concerts, artists, venues, or events.",
  },
  { kind: "h3", text: "You retain ownership" },
  { kind: "p", text: "You retain ownership of your User Content." },
  {
    kind: "p",
    text: "These Terms do not transfer ownership of your User Content to Afterset.",
  },
  { kind: "h3", text: "License to Afterset" },
  {
    kind: "p",
    text: "By submitting User Content, you grant Afterset a non-exclusive, worldwide, royalty-free, sublicensable and transferable license to host, store, reproduce, modify, adapt, format, publish, display, distribute, communicate, and otherwise use that User Content in connection with:",
  },
  {
    kind: "ul",
    items: [
      "operating and providing Afterset;",
      "displaying and distributing content through Afterset;",
      "developing and improving Afterset;",
      "moderating and protecting the service; and",
      "promoting Afterset and its content.",
    ],
  },
  {
    kind: "p",
    text: "This license allows us, for example, to display your review in a feed, on an artist or show page, in search results, or in materials promoting Afterset.",
  },
  {
    kind: "p",
    text: "The license continues for User Content that remains on Afterset after you delete your account or stop using the service.",
  },
  {
    kind: "p",
    text: "This license does not give Afterset ownership of your User Content.",
  },
  { kind: "h3", text: "Your responsibilities" },
  {
    kind: "p",
    text: "You represent that you have the rights necessary to submit your User Content and grant the license described above.",
  },
  {
    kind: "p",
    text: "You are responsible for your User Content and for ensuring that it complies with these Terms and applicable law.",
  },

  { kind: "h2", text: "5. Content That Is Not Allowed" },
  {
    kind: "p",
    text: "You may not use Afterset to post, upload, submit, or distribute content that:",
  },
  {
    kind: "ul",
    items: [
      "is unlawful;",
      "infringes another person's intellectual-property or proprietary rights;",
      "contains another person's private or confidential information without authorization;",
      "constitutes harassment, threats, or targeted abuse;",
      "impersonates another person or misrepresents its source;",
      "contains malicious software or code;",
      "is fraudulent or intentionally deceptive in a manner likely to harm others;",
      "is spam or unauthorized commercial solicitation; or",
      "otherwise violates these Terms.",
    ],
  },
  {
    kind: "p",
    text: "We may remove, restrict, or decline to distribute content that violates these Terms or presents risks to users, Afterset, or third parties.",
  },

  { kind: "h2", text: "6. Reviews and Opinions" },
  {
    kind: "p",
    text: "Reviews and ratings on Afterset reflect the opinions of individual users.",
  },
  {
    kind: "p",
    text: "Afterset does not endorse or guarantee the accuracy of user reviews.",
  },
  {
    kind: "p",
    text: "You agree not to manipulate ratings, coordinate fraudulent reviews, submit reviews for events you knowingly did not attend where attendance is required, or otherwise attempt to artificially influence Afterset's review system.",
  },

  { kind: "h2", text: "7. Concert, Artist and Venue Information" },
  {
    kind: "p",
    text: "Afterset aggregates and organizes information about concerts, artists, venues, and events.",
  },
  {
    kind: "p",
    text: "Some information may originate from users, venues, promoters, ticketing platforms, event-data providers, publicly available sources, or other third parties.",
  },
  {
    kind: "p",
    text: "Event information may change, be incomplete, or contain errors. Afterset does not guarantee the accuracy, availability, start time, lineup, venue, ticket availability, cancellation status, or other details of any event.",
  },
  {
    kind: "p",
    text: "You should verify important event information with the relevant venue, promoter, artist, or ticket provider.",
  },
  {
    kind: "p",
    text: "Afterset is not a ticket seller and, unless expressly stated otherwise, is not affiliated with, endorsed by, or responsible for the artists, venues, promoters, ticketing services, or other third parties referenced through the service.",
  },

  { kind: "h2", text: "8. Afterset's Intellectual Property" },
  {
    kind: "p",
    text: "Except for User Content and third-party materials, Afterset and its licensors own the service and the software, design, branding, interfaces, features, compilations, and other materials comprising Afterset.",
  },
  {
    kind: "p",
    text: "These Terms do not grant you ownership of Afterset's intellectual property.",
  },
  {
    kind: "p",
    text: "Subject to these Terms, Afterset grants you a limited, personal, non-exclusive, non-transferable, revocable right to use the service for its intended purposes.",
  },
  {
    kind: "p",
    text: "You may not copy, reverse engineer, sell, sublicense, scrape, systematically extract, or commercially exploit the service except as permitted by law or with our written permission.",
  },

  { kind: "h2", text: "9. Third-Party Services" },
  {
    kind: "p",
    text: "Afterset may display information from or provide access to third-party services.",
  },
  {
    kind: "p",
    text: "Those services are operated independently from Afterset and may be governed by their own terms and privacy policies.",
  },
  {
    kind: "p",
    text: "Afterset is not responsible for third-party services, their availability, their content, or actions taken by third parties.",
  },

  { kind: "h2", text: "10. Prohibited Conduct" },
  { kind: "p", text: "You may not:" },
  {
    kind: "ul",
    items: [
      "access or use Afterset in violation of law;",
      "interfere with the operation or security of the service;",
      "attempt to gain unauthorized access to accounts, systems, databases, or networks;",
      "circumvent rate limits, access restrictions, security controls, or moderation systems;",
      "use automated systems to access Afterset in a manner that imposes an unreasonable burden on the service;",
      "scrape or systematically extract Afterset content for commercial purposes without written permission;",
      "introduce malware or harmful code;",
      "use Afterset to facilitate fraud or abuse;",
      "manipulate engagement, ratings, attendance, rankings, or other platform signals;",
      "collect information about other users in violation of law or these Terms; or",
      "assist another person in doing any of the above.",
    ],
  },

  { kind: "h2", text: "11. Moderation and Enforcement" },
  {
    kind: "p",
    text: "User Content may be published without advance review.",
  },
  {
    kind: "p",
    text: "We reserve the right, but do not undertake a general obligation, to review, restrict, remove, restore, or moderate User Content.",
  },
  {
    kind: "p",
    text: "We may investigate reports, restrict functionality, suspend accounts, or terminate accounts when we reasonably determine that doing so is appropriate to enforce these Terms, protect the service or its users, or comply with law.",
  },
  {
    kind: "p",
    text: "Moderation decisions may affect whether content appears in feeds, search results, ratings, rankings, or other parts of Afterset.",
  },

  { kind: "h2", text: "12. Copyright Complaints" },
  { kind: "p", text: "We respect intellectual-property rights." },
  {
    kind: "p",
    text: "If you believe content available through Afterset infringes your copyright, contact us at support@afterset.fm with sufficient information for us to identify the work, the allegedly infringing material, and how to contact you.",
  },
  {
    kind: "p",
    text: "We may remove or restrict material when appropriate.",
  },

  { kind: "h2", text: "13. Account Deletion" },
  {
    kind: "p",
    text: "You may request deletion of your account using the functionality provided by Afterset.",
  },
  {
    kind: "p",
    text: "Afterset currently provides a 30-day grace period before completing the account-deletion process.",
  },
  {
    kind: "p",
    text: "Deleting your account does not necessarily remove User Content or activity that forms part of Afterset's historical record. Certain contributions, including reviews, comments, likes, and attendance records, may remain after identifying account information has been removed.",
  },
  {
    kind: "p",
    text: "The license granted under Section 4 continues with respect to User Content that remains on the service.",
  },

  { kind: "h2", text: "14. Service Availability" },
  {
    kind: "p",
    text: "We aim to provide a reliable service, but Afterset may occasionally be unavailable, interrupted, delayed, changed, or contain errors.",
  },
  {
    kind: "p",
    text: "We may modify, suspend, or discontinue all or part of the service at any time.",
  },
  {
    kind: "p",
    text: "We do not guarantee that particular content, functionality, accounts, event records, or features will always remain available.",
  },

  { kind: "h2", text: "15. Disclaimer of Warranties" },
  {
    kind: "p",
    text: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, AFTERSET IS PROVIDED “AS IS” AND “AS AVAILABLE.”",
  },
  {
    kind: "p",
    text: "AFTERSET LLC DISCLAIMS WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.",
  },
  {
    kind: "p",
    text: "WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR ACCURATE OR THAT INFORMATION AVAILABLE THROUGH AFTERSET WILL ALWAYS BE COMPLETE OR CURRENT.",
  },
  {
    kind: "p",
    text: "Nothing in these Terms excludes warranties or rights that cannot lawfully be excluded.",
  },

  { kind: "h2", text: "16. Limitation of Liability" },
  {
    kind: "p",
    text: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, AFTERSET LLC AND ITS OFFICERS, MEMBERS, EMPLOYEES, CONTRACTORS, AND AGENTS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES ARISING FROM OR RELATING TO YOUR USE OF AFTERSET.",
  },
  {
    kind: "p",
    text: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, AFTERSET LLC'S TOTAL LIABILITY FOR CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF $100 OR THE AMOUNT YOU PAID AFTERSET DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.",
  },
  {
    kind: "p",
    text: "These limitations apply only to the extent permitted by applicable law.",
  },

  { kind: "h2", text: "17. Indemnification" },
  {
    kind: "p",
    text: "To the extent permitted by law, you agree to indemnify and hold harmless Afterset LLC and its officers, members, employees, contractors, and agents from claims, liabilities, damages, losses, and reasonable expenses arising from:",
  },
  {
    kind: "ul",
    items: [
      "your User Content;",
      "your violation of these Terms;",
      "your violation of applicable law; or",
      "your violation of another person's rights.",
    ],
  },

  { kind: "h2", text: "18. Termination" },
  { kind: "p", text: "You may stop using Afterset at any time." },
  {
    kind: "p",
    text: "We may suspend or terminate access to Afterset if you materially violate these Terms, create risk or potential legal exposure for Afterset or others, or use the service in a manner that threatens its security or integrity.",
  },
  {
    kind: "p",
    text: "Provisions that by their nature should survive termination will survive, including provisions concerning User Content licenses, intellectual property, disclaimers, limitations of liability, and dispute-related terms.",
  },

  { kind: "h2", text: "19. Changes to These Terms" },
  { kind: "p", text: "We may update these Terms as Afterset evolves." },
  {
    kind: "p",
    text: "If we make material changes, we may provide notice through Afterset, by email, or by another reasonable method.",
  },
  {
    kind: "p",
    text: "Your continued use of Afterset after updated Terms become effective constitutes acceptance of those Terms to the extent permitted by law.",
  },

  { kind: "h2", text: "20. Governing Law and Venue" },
  {
    kind: "p",
    text: "These Terms are governed by the laws of the State of New York, without regard to its conflict-of-laws principles.",
  },
  {
    kind: "p",
    text: "Subject to applicable law, any dispute arising out of or relating to these Terms or Afterset will be brought in the state or federal courts located in New York County, New York, and you and Afterset consent to the personal jurisdiction of those courts.",
  },

  { kind: "h2", text: "21. General Terms" },
  {
    kind: "p",
    text: "If any provision of these Terms is found unenforceable, the remaining provisions will remain in effect.",
  },
  {
    kind: "p",
    text: "Our failure to enforce a provision is not a waiver of our right to do so later.",
  },
  {
    kind: "p",
    text: "You may not assign these Terms without our consent. Afterset may assign these Terms in connection with a merger, acquisition, reorganization, sale of assets, or similar transaction.",
  },
  {
    kind: "p",
    text: "These Terms, together with the Privacy Policy and any additional terms expressly incorporated into them, constitute the agreement between you and Afterset concerning the service.",
  },

  { kind: "h2", text: "22. Contact" },
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

export default function TermsPage() {
  return (
    <LegalDocument
      title="Afterset Terms of Service"
      effectiveDate="Effective Date: September 27, 2026"
      blocks={blocks}
    />
  );
}
