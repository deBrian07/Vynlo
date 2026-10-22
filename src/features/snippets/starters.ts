import type { Snippet } from '../../types/model';

const STARTERS: Pick<Snippet, 'title' | 'category' | 'content'>[] = [
  {
    title: 'Internship follow-up',
    category: 'Follow-ups',
    content:
      'Hi {{first_name}},\n\nI wanted to follow up on my application for the {{position}} role at {{company}}. I am still very interested, and I would be glad to provide anything else that would be useful.\n\nThank you,',
  },
  {
    title: 'Thank-you message',
    category: 'Follow-ups',
    content:
      'Hi {{first_name}},\n\nThank you for taking the time to speak with me about {{position}}. I enjoyed learning more about the work at {{company}}, and I appreciate the conversation.\n\nBest,',
  },
  {
    title: 'Meeting request',
    category: 'Scheduling',
    content:
      'Hi {{first_name}},\n\nWould you have 30 minutes this week to talk about {{position}}? I am happy to work around your schedule.\n\nThank you,',
  },
  {
    title: 'Introduction',
    category: 'Outreach',
    content:
      'Hi {{first_name}},\n\nI am reaching out because I am interested in {{position}} at {{company}}. I would appreciate a chance to learn more about the role if you have a few minutes.\n\nThank you,',
  },
  {
    title: 'Professional outreach',
    category: 'Outreach',
    content:
      'Hi {{first_name}},\n\nI have been following the work at {{company}} and wanted to introduce myself. If it is useful, I would be glad to share a short note about how I could help with {{position}}.\n\nBest,',
  },
  {
    title: 'Scheduling response',
    category: 'Scheduling',
    content:
      'Hi {{first_name}},\n\nThank you for the invitation. I can meet at the time you suggested, and I will send a calendar hold once I know the details.\n\nBest,',
  },
];

export function starterSnippets(now = Date.now()): Snippet[] {
  return STARTERS.map((snippet) => ({
    ...snippet,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
}
