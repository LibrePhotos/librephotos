# Positioning validation kit

The positioning in `00-positioning.md` is a **hypothesis** until the three checks below have run with people who are not the maintainers. Success thresholds are fixed here, before anyone sees the draft, so the result can't be argued into a pass afterwards.

## 1. JTBD switch interviews (5-10 people)

**Who:**

| Slot | Profile | Count |
| --- | --- | --- |
| A | Current LibrePhotos user who switched from something else | 2-3 |
| B | Person who tried LibrePhotos and left (ideally to Immich) | 2 |
| C | Immich or PhotoPrism user who never tried LibrePhotos | 2 |
| D | Google Photos / iCloud user actively looking to leave | 1-2 |

Where to recruit: Discord, GitHub Sponsors, Weblate translators (A); closed issues with "switching to" / "moving to" (B); r/selfhosted (C, D). Offer nothing that biases the answer (no "help us beat Immich").

**Rules:** 30-45 minutes, recorded with consent, one interviewer plus one note-taker. Ask about a *specific past moment*, never hypotheticals ("would you use..."). Don't pitch, don't defend LibrePhotos, don't name candidate differentiators before the interviewee does.

**Script (Moesta "forces of progress" timeline):**

1. *First thought.* "When did you first think your old way of managing photos wasn't working? What were you doing that day?"
2. *Push.* "What exactly went wrong? What did it cost you?" (Look for: storage bill, a lost photo, a policy change, a broken update, a family member.)
3. *Passive looking.* "What did you notice or read before you started actively looking?"
4. *Active looking.* "Which options did you seriously consider? How did you compare them? What did you actually install?"
5. *Pull.* "What made the one you picked feel like the answer? When did you know?"
6. *Anxiety.* "What almost stopped you? What were you afraid of losing?" (Look for: lock-in, data loss, setup effort, family acceptance, mobile backup.)
7. *Habit.* "What about the old way did you miss or keep doing anyway?"
8. *Deciding moment.* "Walk me through the day you committed. Who else was involved?"
9. *Since then.* "What's better, what's worse? What would make you leave again?"
10. *Folder truth probe* (only after 1-9). "Do any other tools touch the same photo files (Lightroom, digiKam, a phone, a NAS app)? What happens to your edits if you leave this app?"

**Output per interview:** a single row in `interviews.csv`: slot, from, to, push, pull, anxiety, habit, hardware, library size, number of users, whether files are shared with other tools, and the verbatim quote that best captures the job.

**Pass threshold:** the job behind the proposed positioning appears **unprompted** in at least 3 of the A+B interviews, and in at least 1 of the C interviews.

## 2. Repeat-back test (positioning paragraph)

Show the single positioning paragraph (from `00-positioning.md`) and nothing else to 5 people from slots C and D. Ask, in this order:

1. "In your own words, who is this for?"
2. "Why would someone pick it over what you use today?"
3. "Who should *not* use it?"
4. "Is there anything here you don't believe?"

**Pass threshold:** at least 4 of 5 name the intended best-fit user and the intended main reason, in words that match. Any claim that 2 or more people say they don't believe goes to the benchmark for proof or gets cut.

## 3. Sean Ellis survey (current users)

Post in Discord, GitHub Discussions and the release notes. No login, anonymous, 5 questions:

1. How would you feel if you could no longer use LibrePhotos? *(Very disappointed / Somewhat disappointed / Not disappointed / I no longer use it)*
2. What type of person do you think would benefit most from LibrePhotos? *(free text)*
3. What is the main benefit you get from LibrePhotos? *(free text)*
4. What would you use instead if LibrePhotos disappeared? *(free text)*
5. How could we improve LibrePhotos for you? *(free text)*

**Analysis:** code answers to Q3 and Q4 blind, without looking at the proposed differentiator first. Segment Q1 by hardware and library size if respondents mention them.

**Pass thresholds:**

- At least 40 % "very disappointed" among the respondents who chose the best-fit segment. If it's under 40 % overall but above it in one segment, that segment is the real best-fit user.
- The proposed main benefit is the top or second most common Q3 code among the "very disappointed" respondents.
- The most common Q4 answer confirms the competitive alternative the positioning is written against.

## 4. Reproducibility (benchmark claims)

Every quantitative claim in the positioning (RAM, import speed, metadata fidelity, exit cost) must link to a run of `benchmarks/teardown/` that a stranger can repeat.

**Pass threshold:** one person outside the maintainer team reruns it and gets results within 15 % on timing and identical results on fidelity and export checks.

## 5. After publishing

Watch for 8 weeks after the docs landing page and README carry the new positioning:

- New issues, Discord intros and Reddit mentions that state the reason for choosing LibrePhotos. The test is whether the differentiator shows up in their words.
- Docs landing page to install-docs click-through (if analytics exist), Docker pulls and star trend compared with the 8 weeks before.
- Whether a third party (reviewer, blogger, YouTuber) describes LibrePhotos the same way without being briefed.

## What would prove the positioning wrong

- Interviewees in slot B left for a reason the positioning claims as LibrePhotos' strength.
- The repeat-back test produces a different "who it's for" from most readers.
- The benchmark shows a competitor matches the claimed advantage on default settings.
- The "very disappointed" users value something else entirely. If so, re-position around that, not around what the maintainers believed.
