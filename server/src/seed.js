/**
 * Seeds the tracker from "Marketing_MBR_Templates New.pptx" (August 2026 MBR).
 *
 *  - August 2026 (2026-08) is loaded as completed tasks carrying the deck's KEY WINS
 *    as their recorded results, so the lead starts with a real baseline month.
 *  - September 2026 (2026-09) is loaded from every FOCUS FOR NEXT MONTH slide,
 *    split into measurable targets and narrative targets, each with a starter task.
 *
 * Run:  npm run seed          (only seeds an empty database)
 *       npm run reseed        (wipes and rebuilds)
 */
import bcrypt from 'bcryptjs';
import db, { seedDefaultFields } from './db.js';

const FORCE = process.argv.includes('--force');
const AUG = '2026-08';
const SEP = '2026-09';
const DEFAULT_PASSWORD = 'Cloudfuze@123';

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0 && !FORCE) {
  console.log('Database already has data. Use "npm run reseed" to wipe and rebuild.');
  process.exit(0);
}

if (FORCE) {
  // Wiping teams cascades into the monthly sheet, so anything the marketing team
  // typed would go with it. Refuse unless that is asked for in as many words.
  const filled = db.prepare(
    `SELECT COUNT(*) AS n FROM scorecard_cells WHERE target <> '' OR achieved <> ''`
  ).get().n;
  if (filled && !process.argv.includes('--wipe-sheet')) {
    console.log(`\n  Refusing to reseed: the monthly sheet has ${filled} box(es) filled in,`);
    console.log('  and rebuilding the teams would delete them.\n');
    console.log('  Back up server/data.db first, then, if you really mean it:');
    console.log('      node src/seed.js --force --wipe-sheet\n');
    process.exit(1);
  }
  db.exec(`DELETE FROM activity; DELETE FROM comments; DELETE FROM attachments;
           DELETE FROM tasks; DELETE FROM targets; DELETE FROM snapshots;
           DELETE FROM scorecard_cells; DELETE FROM scorecard_rows;
           DELETE FROM scorecard_fields;
           DELETE FROM users; DELETE FROM teams;
           DELETE FROM sqlite_sequence WHERE name IN
             ('activity','comments','attachments','tasks','targets','snapshots',
              'scorecard_cells','scorecard_rows','scorecard_fields','users','teams');`);
}

/* ------------------------------------------------------------------ teams */

const TEAMS = [
  ['Content Team', 'Technical content, blogs, landing pages and content refresh', '#059669', 1],
  ['PPC', 'Paid search — spend, cost per lead and paid pipeline', '#0891b2', 2],
  ['SEO/GEO Team', 'Organic search, off-page, newsletters, webinars and guest blogs', '#2563eb', 3],
  ['Wordpress Team', 'WordPress development, site performance and technical SEO', '#7c3aed', 4],
  ['Design Team', 'Images, landing pages, whitepapers and collateral', '#db2777', 5],
  ['Business Development', 'Outbound, demos and pipeline generation', '#ea580c', 6],
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const insTeam = db.prepare('INSERT INTO teams (name, slug, description, colour, sort_order) VALUES (?,?,?,?,?)');
const team = {};
for (const [name, description, colour, order] of TEAMS) {
  team[name] = insTeam.run(name, slugify(name), description, colour, order).lastInsertRowid;
}

/* ---------------------------------------------------------------- people */

// [name, email, role, designation, team, reports to]
const PEOPLE = [
  ['Arun Jyothi', 'jyothi@cloudfuze.com', 'lead', 'Marketing Manager', null, ''],
  ['Venkata Rahul', 'rahul@cloudfuze.com', 'member', 'Senior SEO & PPC Executive', 'SEO/GEO Team', 'Arun Jyothi'],
  ['Narayana Reddy', 'narayana@cloudfuze.com', 'member', 'SEO Executive', 'SEO/GEO Team', 'Arun Jyothi'],
  ['Anil', 'anil@cloudfuze.com', 'member', 'SEO Trainee Mentor', 'SEO/GEO Team', 'Venkata Rahul'],
  ['Manisha', 'manisha@cloudfuze.com', 'member', 'SEO Trainee Mentor', 'SEO/GEO Team', 'Venkata Rahul'],
  ['Pankaj Rai', 'pankaj@cloudfuze.com', 'member', 'Senior Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Aayushi', 'aayushi@cloudfuze.com', 'member', 'Senior Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Rashmi', 'rashmi@cloudfuze.com', 'member', 'Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Bhuvana', 'bhuvana@cloudfuze.com', 'member', 'Technical Content Writer (Trainee)', 'Content Team', 'Pankaj Rai'],
  ['Preksha', 'preksha@cloudfuze.com', 'member', 'Technical Content Writer (Trainee)', 'Content Team', 'Pankaj Rai'],
  ['Nirosh Reddy S L', 'nirosh@cloudfuze.com', 'member', 'WordPress Developer', 'Wordpress Team', 'Arun Jyothi'],
  ['Ashu Tiwary', 'ashu@cloudfuze.com', 'member', 'WordPress Developer', 'Wordpress Team', 'Arun Jyothi'],
  ['Hari Rowlo', 'hari@cloudfuze.com', 'member', 'UI/UX Designer', 'Design Team', 'Arun Jyothi'],
  ['Raj Patsamatla', 'raj@cloudfuze.com', 'member', 'Business Development Executive', 'Business Development', 'Arun Jyothi'],
  ['Abhigna', 'abhigna@cloudfuze.com', 'member', 'Business Development Executive', 'Business Development', 'Arun Jyothi'],
  ['CEO / Stakeholder', 'stakeholder@cloudfuze.com', 'stakeholder', 'Read-only board view', null, ''],
];

const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
const insUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, role, designation, team_id, reports_to)
   VALUES (?,?,?,?,?,?,?)`);
const user = {};
for (const [name, email, role, designation, teamName, reportsTo] of PEOPLE) {
  user[name] = insUser.run(name, email, hash, role, designation,
    teamName ? team[teamName] : null, reportsTo).lastInsertRowid;
}
const LEAD = user['Arun Jyothi'];
const teamOf = (person) => {
  const row = PEOPLE.find((p) => p[0] === person);
  return row && row[4] ? team[row[4]] : null;
};

/* -------------------------------------------- August 2026 — what shipped */

// [owner, title, result, result_metric, impact, category]
const AUG_TASKS = [
  // SEO — Venkata Rahul (slide 2)
  ['Venkata Rahul', 'Grow high-intent Top 10 keyword rankings', 'High-intent Top 10 keywords grew 27%, from 87 to 111.', 'Top 10 keywords 87 → 111 (+27%)', 'High', 'SEO'],
  ['Venkata Rahul', 'Drive overall organic traffic growth', 'Overall website traffic increased 15% (6,138 → 7,068); combination traffic grew 28% (2,727 → 3,510).', 'Traffic +15%, combination +28%', 'High', 'SEO'],
  ['Venkata Rahul', 'Maintain SEO technical foundation', '100% Core Web Vitals pass rate maintained; indexed pages increased to 1,945.', 'CWV 100% pass, 1,945 indexed', 'Medium', 'SEO'],
  ['Venkata Rahul', 'Complete on-page optimisations', '25 pages optimised (ongoing).', '25 pages optimised', 'Medium', 'SEO'],
  ['Venkata Rahul', 'Benchmark AI visibility vs competitors', 'CloudFuze 28, Cloudiway 22, CloudM 24, BitTitan 35, ShareGate 32.', 'CloudFuze AI visibility 28', 'Medium', 'SEO'],
  // PPC — Venkata Rahul (slide 3)
  ['Venkata Rahul', 'Grow PPC lead volume', 'PPC leads increased 30%, from 26 to 34.', 'PPC leads 26 → 34 (+30%)', 'High', 'PPC'],
  ['Venkata Rahul', 'Increase paid clicks while holding CTR', 'Clicks increased 40%, from 838 to 1,175, while maintaining 5.3% CTR.', 'Clicks 838 → 1,175 at 5.3% CTR', 'High', 'PPC'],
  ['Venkata Rahul', 'Improve CPC efficiency', 'CPC improved 3%, from $16.00 to $15.53.', 'CPC $16.00 → $15.53', 'Medium', 'PPC'],
  ['Venkata Rahul', 'Manage August ad spend', 'Total ad spend $18,257; CPL $537 (up 4% on a 30% lead increase).', 'Spend $18,257, CPL $537', 'Medium', 'PPC'],
  // Off-page / SEO — Narayana Reddy (slide 4)
  ['Narayana Reddy', 'Grow referring domains', 'Referring domain count increased 2% vs July, from 2,141 to 2,187.', 'Referring domains 2,141 → 2,187', 'High', 'Off-page'],
  ['Narayana Reddy', 'Improve referral traffic', 'Referral traffic improved 58% compared with July.', 'Referral traffic +58%', 'High', 'Off-page'],
  ['Narayana Reddy', 'Acquire high-DA guest post backlinks', '7 high-DA guest post links acquired in August.', '7 guest post links', 'Medium', 'Off-page'],
  ['Narayana Reddy', 'Clean up toxic backlink profile', 'High-toxicity backlinks identified and removed, improving the overall backlink profile.', 'Toxic backlinks removed', 'Medium', 'Off-page'],
  ['Narayana Reddy', 'Grow social media following', 'Follower count increased 6% in August, from 12,097 to 12,345.', 'Followers 12,097 → 12,345 (+6%)', 'Medium', 'Social'],
  ['Narayana Reddy', 'Send monthly Mailchimp newsletters', '2 newsletters sent in August.', '2 newsletters', 'Low', 'Email'],
  ['Narayana Reddy', 'Fix technical audit issues', 'Working through "Crawled but not indexed" pages, duplicate title tags and 404 pages.', 'Audit fixes in progress', 'Medium', 'Technical SEO'],
  // Content — Pankaj Rai (slide 5)
  ['Pankaj Rai', 'Publish technical content pieces', '18 pieces published in August.', '18 pieces published', 'High', 'Content'],
  ['Pankaj Rai', 'Reduce article bounce rate', 'Bounce rate reduced from 18.9% in July to 15.1% in August.', 'Bounce 18.9% → 15.1%', 'High', 'Content'],
  ['Pankaj Rai', 'Improve average views per article', 'Average views per article improved from 7 in July to 18 in August.', 'Avg views 7 → 18', 'High', 'Content'],
  ['Pankaj Rai', 'Expand migration combination footprint', 'Expanded to new combos: Teams to Slack, SharePoint 2016/2019 to SPO, Claude to Gemini, Gemini to Gemini.', '4+ new combinations covered', 'Medium', 'Content'],
  ['Pankaj Rai', 'Run content decay audit and refresh', '12 pieces updated / refreshed.', '12 pieces refreshed', 'Medium', 'Content'],
  ['Pankaj Rai', 'Onboard and train new writers', 'Bhuvana and Preksha onboarded and in training.', '2 writers in training', 'Medium', 'Enablement'],
  // Content — Aayushi (slide 6)
  ['Aayushi', 'Publish technical content pieces', '23 pieces published in August.', '23 pieces published', 'High', 'Content'],
  ['Aayushi', 'Reduce article bounce rate', 'Bounce rate reduced from 22% in July to 16.3% in August.', 'Bounce 22% → 16.3%', 'High', 'Content'],
  ['Aayushi', 'Improve average views per article', 'Average views per article increased from 12 in July to 20 in August.', 'Avg views 12 → 20', 'High', 'Content'],
  ['Aayushi', 'Strengthen email and M365 tenant migration content', 'Strengthened email and Microsoft 365 tenant migration content for enterprise ICPs; improved SEO performance through optimisation and ranking-recovery updates.', '10% of combination keywords improved', 'High', 'Content'],
  ['Aayushi', 'Run content decay audit and refresh', '8 pieces updated / refreshed.', '8 pieces refreshed', 'Medium', 'Content'],
  // Content — Rashmi (slide 7)
  ['Rashmi', 'Write blogs and landing pages', '20 pieces written against plan.', '20 pieces written', 'High', 'Content'],
  ['Rashmi', 'Improve content keyword rankings', 'Content keyword rankings improved 28%, boosting overall search visibility and organic reach.', 'Keyword rankings +28%', 'High', 'Content'],
  ['Rashmi', 'Reduce bounce rate on published content', 'Bounce rate reduced from 18.3% to 7.8%; average time on page 1 min 22 sec.', 'Bounce 18.3% → 7.8%', 'High', 'Content'],
  ['Rashmi', 'Publish thought leadership optimised for AI search', 'Authored thought leadership articles and optimised content for AI search visibility.', 'AI-optimised articles published', 'Medium', 'Content'],
  // Developers — Nirosh (slide 8)
  ['Nirosh Reddy S L', 'Fix critical site performance issue', 'Swift Performance plugin caused 500/522 errors (vendor-side). Root cause diagnosed same day; vendor unresponsive for 2 days, so migrated to WP Rocket. Resolved site-wide.', 'Swift Performance → WP Rocket', 'High', 'Performance'],
  ['Nirosh Reddy S L', 'Ship landing pages and articles', '8 new + 8 updated landing pages, 40 articles, quiz widget improved.', '16 LPs, 40 articles, 1 widget', 'High', 'Development'],
  ['Nirosh Reddy S L', 'Maintain uptime and Core Web Vitals', '100% uptime; CWV 728/728 URLs "Good" on mobile and desktop; 142ms average response time; no host issues in 90 days.', '100% uptime, 728/728 CWV Good', 'High', 'Performance'],
  ['Nirosh Reddy S L', 'Apply security and plugin updates', 'WordPress core, 20 plugins and theme updated; 1 security patch applied.', '20 plugins + 1 security patch', 'Medium', 'Security'],
  ['Nirosh Reddy S L', 'Start FAQ schema backfill on legacy articles', 'FAQ schema added to older articles; approximately 100 remaining.', 'FAQ schema started, ~100 left', 'Medium', 'Technical SEO'],
  ['Nirosh Reddy S L', 'Audit indexation and crawl health', '1,843 pages across 4 sitemaps reading successfully. 1.95K indexed / 1.8K not indexed (mostly intentional). 863 "Crawled – not indexed". 85 redirects + 26 404s in validation.', '85 redirects + 26 404s open', 'Medium', 'Technical SEO'],
  // Developers — Ashu (slide 9)
  ['Ashu Tiwary', 'Publish pages and articles on Exinent and CloudFuze', '10 pages and 27 articles published on exinent.com; 8 articles published/updated on cloudfuze.com.', '10 pages, 35 articles', 'High', 'Development'],
  ['Ashu Tiwary', 'Fix critical CF7 IP Restrict plugin bugs', 'Critical bugs fixed in the CF7 IP Restrict plugin (spam/bot protection).', 'Critical bugs fixed', 'High', 'Development'],
  ['Ashu Tiwary', 'Release CF7 IP Restrict update', 'New version released with dynamic lockout-time control and 3 independent enable/disable toggles (keyword block, IP block, lockout-after-submit).', 'New plugin version shipped', 'High', 'Development'],
  ['Ashu Tiwary', 'Apply WordPress security updates', 'WordPress core updated to v7.0.4 along with 10 plugin updates.', 'Core v7.0.4 + 10 plugins', 'Medium', 'Security'],
  // Design — Hari (slide 10)
  ['Hari Rowlo', 'Deliver design requests for the month', '82 images designed including blog featured images, infographics, social media creatives and LinkedIn newsletters. Webinar PPT designs delivered separately.', '82 designs delivered', 'High', 'Design'],
  ['Hari Rowlo', 'Design case study and collateral pages', 'Estée Lauder case study landing page and brochure delivered.', '1 case study page + brochure', 'High', 'Design'],
  ['Hari Rowlo', 'Deliver PPC ad creatives', '3 PPC landing pages delivered on time.', '3 PPC landing pages', 'Medium', 'Design'],
  ['Hari Rowlo', 'Reduce design turnaround time', 'Average turnaround time reduced to 1.5 business days; revisions reduced by incorporating feedback early.', 'Turnaround 1.5 business days', 'Medium', 'Design'],
  // BD — Raj (slide 11)
  ['Raj Patsamatla', 'Run outbound calling', '1,889 calls made in August.', '1,889 calls', 'High', 'Outbound'],
  ['Raj Patsamatla', 'Run outbound email outreach', '1,867 emails sent in August.', '1,867 emails', 'High', 'Outbound'],
  ['Raj Patsamatla', 'Schedule and run demos', '11 demos scheduled; demos completed with enterprise accounts and MSPs, nurturing ongoing.', '11 demos scheduled', 'High', 'Demos'],
  ['Raj Patsamatla', 'Convert demos into qualified leads', '9 leads converted from demos, a 50% increase.', '9 leads (+50%)', 'High', 'Pipeline'],
  ['Raj Patsamatla', 'Build August pipeline', 'Pipeline added for August is above $76K: 2 manage opportunities and 7 migration opportunities.', '$76K+ pipeline', 'High', 'Pipeline'],
  // BD — Abhigna (slide 12)
  ['Abhigna', 'Run outbound calling', '1,948 calls made in August.', '1,948 calls', 'High', 'Outbound'],
  ['Abhigna', 'Run outbound email outreach', '1,937 emails sent in August.', '1,937 emails', 'High', 'Outbound'],
  ['Abhigna', 'Schedule and run demos', '6 demos scheduled, including 2 AI Governance demos completed.', '6 demos, 2 AI Governance', 'High', 'Demos'],
  ['Abhigna', 'Convert demos into qualified leads', '3 leads converted from demos.', '3 leads', 'Medium', 'Pipeline'],
  ['Abhigna', 'Improve ICP understanding and targeting', 'Improved understanding of ICPs and generated conversations around migration and AI governance with enterprises showing active migration triggers.', 'ICP conversations generated', 'Medium', 'Pipeline'],
  // Marketing Manager — Jyothi (slide 13)
  ['Arun Jyothi', 'Hit the monthly lead target', 'Achieved 184 leads against a 220 target (84%, gap -16%). Channel mix: organic 146, paid 34, social 3, referral 1.', '184 / 220 leads (84%)', 'High', 'Leadership'],
  ['Arun Jyothi', 'Grow enterprise lead volume', 'Enterprise leads grew from 10 in July to 17 in August.', 'ENT leads 10 → 17', 'High', 'Leadership'],
  ['Arun Jyothi', 'Reduce overall site bounce rate', 'Overall bounce rate decreased from 19.9% in July to 15.3% in August.', 'Bounce 19.9% → 15.3%', 'High', 'Leadership'],
  ['Arun Jyothi', 'Secure third-party recognition', 'G2 recognition: 2 Leader badges + 1 High Performer badge, strengthening visibility and credibility in Cloud Migration and File Migration.', '3 G2 badges', 'High', 'Brand'],
];

const insTask = db.prepare(`
  INSERT INTO tasks (title, description, team_id, assignee_id, created_by, target_id,
                     start_date, end_date, completed_on, status, priority, progress,
                     category, result, result_metric, impact, blocker, cycle)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

db.transaction(() => {
  for (const [owner, title, result, metric, impact, category] of AUG_TASKS) {
    insTask.run(title, '', teamOf(owner), user[owner], LEAD, null,
      '2026-08-01', '2026-08-31', '2026-08-31', 'Completed',
      impact === 'High' ? 'High' : 'Medium', 100, category, result, metric, impact, '', AUG);
  }
})();

/* ------------------------------------- September 2026 — targets & tasks */

// Measurable: [owner, team, title, metric, unit, baseline, target, direction, source]
const METRIC_TARGETS = [
  ['Venkata Rahul', 'SEO & PPC', 'Lift visitor conversion rate to 4%', 'Visitor conversion rate', '%', 2.5, 4, 'up', 'Senior SEO Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Recover organic lead volume toward the 220 target', 'Organic leads', 'leads', 146, 220, 'up', 'Senior SEO Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Improve organic CTR through title/meta optimisation', 'Organic CTR', '%', 0.3, 0.5, 'up', 'Senior SEO Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Scale high-intent Top 10 keywords', 'Top 10 keywords', 'keywords', 111, 120, 'up', 'Senior SEO Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Strengthen referring domains', 'Referring domains', 'domains', 2181, 2250, 'up', 'Senior SEO Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Improve PPC conversion rate', 'PPC conversion rate', '%', 3, 5, 'up', 'Senior PPC Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Reduce cost per lead below $470', 'CPL', '$', 537, 470, 'down', 'Senior PPC Executive'],
  ['Venkata Rahul', 'SEO & PPC', 'Hold PPC lead volume despite the 56% budget cut', 'PPC leads', 'leads', 34, 34, 'up', 'Senior PPC Executive'],
  ['Narayana Reddy', 'SEO & PPC', 'Increase high-quality referring domains', 'Referring domains (off-page)', 'domains', 2187, 2250, 'up', 'SEO Executive'],
  ['Narayana Reddy', 'SEO & PPC', 'Improve referral traffic by 80%', 'Referral traffic growth', '%', 58, 80, 'up', 'SEO Executive'],
  ['Narayana Reddy', 'SEO & PPC', 'Increase domain authority to 44', 'Authority Score', 'score', 43, 44, 'up', 'SEO Executive'],
  ['Narayana Reddy', 'SEO & PPC', 'Increase social engagement rate by 20%', 'Engagement rate growth', '%', 0, 20, 'up', 'SEO Executive'],
  ['Nirosh Reddy S L', 'Developers', 'Resolve outstanding redirect and 404 issues', 'Open redirect + 404 URLs', 'URLs', 111, 0, 'down', 'WordPress Developer'],
  ['Nirosh Reddy S L', 'Developers', 'Boost home page mobile PageSpeed lab score to 90+', 'Home page mobile lab score', 'score', null, 90, 'up', 'WordPress Developer'],
  ['Nirosh Reddy S L', 'Developers', 'Complete FAQ schema rollout on legacy articles', 'Legacy articles with FAQ schema', 'articles', 0, 100, 'up', 'WordPress Developer'],
  ['Abhigna', 'Business Development', 'Reach 2,000+ outbound calls', 'Calls made', 'calls', 1948, 2000, 'up', 'Business Development Executive'],
  ['Abhigna', 'Business Development', 'Reach 2,000+ outbound emails', 'Emails sent', 'emails', 1937, 2000, 'up', 'Business Development Executive'],
  ['Abhigna', 'Business Development', 'Schedule 10+ demos', 'Demos scheduled', 'demos', 6, 10, 'up', 'Business Development Executive'],
  ['Abhigna', 'Business Development', 'Generate at least 7 qualified leads', 'Qualified leads', 'leads', 3, 7, 'up', 'Business Development Executive'],
  ['Arun Jyothi', null, 'Close the total lead gap', 'Total leads', 'leads', 184, 220, 'up', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Improve enterprise leads by 20%', 'Enterprise leads', 'leads', 17, 20, 'up', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Grow Top 10 keywords to 120+', 'Top 10 keywords (company)', 'keywords', 111, 120, 'up', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Reduce overall bounce rate to 12%', 'Overall bounce rate', '%', 15.3, 12, 'down', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Publish 4 case studies', 'Case studies published', 'case studies', 0, 4, 'up', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Publish 1 PR release', 'PR releases published', 'releases', 0, 1, 'up', 'Marketing Manager'],
];

// Narrative: [owner, team, title, detail, source]
const NARRATIVE_TARGETS = [
  ['Venkata Rahul', 'SEO & PPC', 'Prioritise high-intent PPC campaigns', 'Shift budget toward campaigns and keywords generating qualified leads and pipeline, rather than optimising purely for clicks or lead volume.', 'Senior PPC Executive'],
  ['Narayana Reddy', 'SEO & PPC', 'Convert unlinked brand mentions into backlinks', 'Track unlinked brand mentions and explore opportunities to convert them into relevant backlinks.', 'SEO Executive'],
  ['Pankaj Rai', 'Content Writers', 'Improve engagement and reduce bounce rate on articles', 'Add customer success stories, CloudFuze reviews, infographics and more to lift average sessions and cut bounce rate.', 'Senior Technical Content Writer'],
  ['Pankaj Rai', 'Content Writers', 'Improve traffic-to-lead conversion with mid-content CTAs', 'Add mid-content CTAs across high-traffic articles to lift the traffic to lead conversion ratio.', 'Senior Technical Content Writer'],
  ['Pankaj Rai', 'Content Writers', 'Position content for enterprise lead generation', 'Focus more on enterprise positioning in order to generate enterprise leads.', 'Senior Technical Content Writer'],
  ['Pankaj Rai', 'Content Writers', 'Improve AI visibility through GEO', 'AI-optimised article structure, third-party articles, Reddit answers and tech community posts.', 'Senior Technical Content Writer'],
  ['Aayushi', 'Content Writers', 'Create high-intent enterprise migration content', 'High-intent enterprise migration content to support lead generation.', 'Senior Technical Content Writer'],
  ['Aayushi', 'Content Writers', 'Refresh declining blogs to recover rankings', 'Identify and refresh declining blogs to improve rankings.', 'Senior Technical Content Writer'],
  ['Aayushi', 'Content Writers', 'Expand AI visibility and AEO efforts', 'Expand AI visibility and answer-engine optimisation work, and improve average views and traffic.', 'Senior Technical Content Writer'],
  ['Aayushi', 'Content Writers', 'Strengthen off-page visibility', 'Guest posts, Medium and Quora around priority migration topics.', 'Senior Technical Content Writer'],
  ['Rashmi', 'Content Writers', 'Drive CloudFuze Manage growth through content', 'Expand the CloudFuze Manage digital footprint through AI-focused content, SEO optimisation and thought leadership initiatives.', 'Technical Content Writer'],
  ['Rashmi', 'Content Writers', 'Improve AI visibility and organic discoverability', 'Improve AI visibility, search performance and organic discoverability across emerging AI platforms and traditional search engines.', 'Technical Content Writer'],
  ['Ashu Tiwary', 'Developers', 'Resolve meta title and description conflicts', 'Update meta titles and descriptions on articles to resolve conflicts with page titles on the CloudFuze website.', 'WordPress Developer'],
  ['Ashu Tiwary', 'Developers', 'Validate CF7 IP Restrict on the dev site', 'Complete thorough testing of the new CF7 IP Restrict features on the dev site to validate stability.', 'WordPress Developer'],
  ['Ashu Tiwary', 'Developers', 'Deploy CF7 IP Restrict to production', 'Deploy the CF7 IP Restrict plugin to the live site once all test cases pass successfully.', 'WordPress Developer'],
  ['Ashu Tiwary', 'Developers', 'Implement FAQ schema on Exinent', 'Implement FAQ schema markup on the Exinent website for better search visibility.', 'WordPress Developer'],
  ['Hari Rowlo', 'Design', 'Run user research before major UI changes', 'Conduct more user research and usability testing before finalising major UI changes.', 'UI/UX Designer'],
  ['Hari Rowlo', 'Design', 'Design the Google Workspace Governance white paper', 'Enterprise Playbook to Google Workspace Governance — white paper design.', 'UI/UX Designer'],
  ['Hari Rowlo', 'Design', 'Build a reusable UI component library', 'Build and maintain reusable UI components to improve consistency and speed.', 'UI/UX Designer'],
  ['Raj Patsamatla', 'Business Development', 'Target M&A, CloudM partners and multi-cloud enterprises', 'Focus on specific M&A accounts, CloudM partners, and enterprise accounts using multiple clouds and Slack workspaces.', 'Business Development Executive'],
  ['Raj Patsamatla', 'Business Development', 'Send follow-up emails within 24 hours of every call', 'Follow-ups lagged in August; ensure follow-up emails go out within 24 hours after each call.', 'Business Development Executive'],
  ['Abhigna', 'Business Development', 'Improve ICP scoring and prioritise enterprise accounts', 'Improve ICP scores and prioritise higher-quality accounts for enterprise.', 'Business Development Executive'],
  ['Arun Jyothi', null, 'Update BOFU articles', 'Update bottom-of-funnel articles to improve keyword rankings, visibility and conversions in the US market.', 'Marketing Manager'],
  ['Arun Jyothi', null, 'Run intent-based LinkedIn ABM', 'Launch intent-based LinkedIn ABM against priority enterprise accounts.', 'Marketing Manager'],
];

const insTarget = db.prepare(`
  INSERT INTO targets (title, detail, team_id, owner_id, cycle, kind, metric_name, unit,
                       baseline, target_value, current_value, direction, status, source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const targetIdByTitle = {};
db.transaction(() => {
  for (const [owner, teamName, title, metric, unit, baseline, target, direction, source] of METRIC_TARGETS) {
    const id = insTarget.run(title, '', teamName ? team[teamName] : null, user[owner], SEP,
      'metric', metric, unit, baseline, target, baseline, direction,
      'Not Started', `Aug 2026 MBR — ${source}`).lastInsertRowid;
    targetIdByTitle[title] = id;
  }
  for (const [owner, teamName, title, detail, source] of NARRATIVE_TARGETS) {
    const id = insTarget.run(title, detail, teamName ? team[teamName] : null, user[owner], SEP,
      'narrative', '', '', null, null, null, 'up',
      'Not Started', `Aug 2026 MBR — ${source}`).lastInsertRowid;
    targetIdByTitle[title] = id;
  }
})();

// One starter task per September target, owned by the same person.
const SEP_OWNER = Object.fromEntries(
  [...METRIC_TARGETS.map((t) => [t[2], t[0]]), ...NARRATIVE_TARGETS.map((t) => [t[2], t[0]])]);

db.transaction(() => {
  for (const [title, owner] of Object.entries(SEP_OWNER)) {
    insTask.run(title, 'Carried over from the August 2026 MBR "Focus for next month".',
      teamOf(owner), user[owner], LEAD, targetIdByTitle[title],
      '2026-09-01', '2026-09-30', null, 'In Progress', 'High', 10,
      'September focus', '', '', '', '', SEP);
  }
})();

/* -------------------------------------------- August company-wide facts */

const SNAPSHOTS = [
  ['Total leads', 184, 'leads', 'Against a 220 target (84% achieved, gap -16%)'],
  ['Total leads (July)', 192, 'leads', 'Against a 280 target (69% achieved)'],
  ['Organic leads', 146, 'leads', 'Down 8% MoM'],
  ['PPC leads', 34, 'leads', 'Up 30% MoM'],
  ['Referral leads', 1, 'leads', ''],
  ['Social media leads', 3, 'leads', ''],
  ['Enterprise leads', 17, 'leads', 'Up from 10 in July'],
  ['Website traffic', 7068, 'users', 'Up 15% MoM from 6,138'],
  ['Combination traffic', 3510, 'users', 'Up 28% MoM from 2,727'],
  ['Top 10 keywords', 111, 'keywords', 'Up 27% from 87'],
  ['Keywords tracked', 2412, 'keywords', '70% ranking in the Top 10'],
  ['Referring domains', 2181, 'domains', 'Up 2% from 2,140'],
  ['Authority Score', 43, 'score', 'Stable MoM'],
  ['Overall bounce rate', 15.3, '%', 'Down from 19.9% in July'],
  ['Visitor conversion rate', 2.5, '%', 'Down from 3%'],
  ['Ad spend', 18257, '$', 'August paid media spend'],
  ['CPL (paid)', 537, '$', 'Up 4% from $516'],
  ['CPL (other channels)', 7, '$', ''],
  ['PPC ROI', 50, '%', '$14,761 returned on $29,700 of PPC lead value'],
  ['Deals won', 13, 'deals', 'Plus 4 won by Anthony'],
  ['AI visibility — CloudFuze', 28, 'score', 'BitTitan 35, ShareGate 32, CloudM 24, Cloudiway 22'],
];

const insSnap = db.prepare(
  'INSERT INTO snapshots (cycle, team_id, metric, value, unit, note) VALUES (?,NULL,?,?,?,?)');
db.transaction(() => {
  for (const [metric, value, unit, note] of SNAPSHOTS) insSnap.run(AUG, metric, value, unit, note);
})();

/* ------------------------------ the monthly sheet columns per team ------- */

// Teams were just rebuilt, so give each one its starter columns back.
seedDefaultFields();

/* ------------------------------------------------------------------ done */

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`
  Seeded from the August 2026 MBR deck
  ------------------------------------
  Teams      : ${count('teams')}
  Members    : ${count('users')}
  Sheet cols : ${count('scorecard_fields')} across the teams
  Tasks      : ${count('tasks')}  (${AUG} completed + ${SEP} in flight)
  Targets    : ${count('targets')} for ${SEP}
  Snapshots  : ${count('snapshots')} August company metrics

  Sign in with any email below, password: ${DEFAULT_PASSWORD}

    jyothi@cloudfuze.com        Marketing Manager (full access)
    rahul@cloudfuze.com         Senior SEO & PPC Executive
    stakeholder@cloudfuze.com   CEO / stakeholder (read-only)
`);
