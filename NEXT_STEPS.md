# Next Steps — ISOFORM

Everything below is NOT built yet. Prioritized by impact.

---

## Before v1.0 App Store Submit

| Priority | Task | Notes |
|----------|------|-------|
| 🔴 | **iCloud sync** | Broken. Enable iCloud capability in Apple Dev portal for `com.maxxxdev.isoform`, rebuild provisioning profile, restore sync code from commit `d4fa0ee` |
| 🟡 | **Program auto-advancement** | Workout summary should check if session meets program step requirements and auto-advance if hit |

---

## v1.1 — Growth & Engagement

| Priority | Task | Confirmation Required? |
|----------|------|----------------------|
| 🔴 | **Challenge voting** | Weekly poll in Train tab: users vote for next week's challenge. Free can vote, paid get 3x votes |
| 🔴 | **Shareable workout cards** | After every session, generate clean share card (rep count, form score, exercise, body skeleton). Clean design matching app aesthetic |
| 🔴 | **Leaderboard (global)** | Supabase or similar. No accounts — use device ID. Daily/weekly/all-time rankings. Free users see all leaderboards, can only play push-up challenges |
| 🟡 | **Challenge history** | Show past challenge scores in a row |

---

## v1.2 — Premium Features

| Priority | Task | Confirmation Required? |
|----------|------|----------------------|
| 🔴 | **Apple IAP payments** | Wire RevenueCat or Apple StoreKit. `$4.99/mo` All Access. Annual option `$39.99/yr`. Consumable IAP: "Form Analysis Pack" |
| 🟡 | **Onboarding as sales funnel** | Goal picker → free push-up demo → paywall. Show value before asking for money |

---

## v1.3 — AI Coach

| Priority | Task | Confirmation Required? |
|----------|------|----------------------|
| 🔴 | **AI Personal Coach** | ⚠️ **DO NOT BUILD until Maxxx confirms.** Needs: OpenAI/Claude API integration, per-session analysis, weekly progress summaries, adaptive programming |

---

## Future Ideas (no date)

- Custom training programs (user-defined progression steps)
- Body transformation tracking (progress photos + form overlay comparisons)
- Apple Watch / HealthKit integration
- Social groups & friend challenges
- More exercises (diamond push-up, dragon flag, human flag, etc.)
