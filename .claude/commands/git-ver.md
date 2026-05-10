# git-ver

Push all local changes from this session to GitHub and trigger a Vercel deployment.

## Steps

1. **Stage and commit** any uncommitted changes:
   - Run `git status` to see what's changed
   - Run `git diff --staged` and `git diff` to review changes
   - Stage all modified tracked files: `git add -u`
   - If there are meaningful changes, commit with a concise message describing what was done in this session
   - If nothing to commit, skip this step

2. **Push** the current branch to GitHub:
   - Run `git push -u origin <current-branch>`
   - Retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s) on network failure

3. **Vercel** deployment is triggered automatically on push — no manual step needed. Confirm by noting that Vercel deploys from GitHub automatically.

4. **Create or update a PR** if one doesn't already exist for the current branch (create as draft).

5. Report back: branch name, commit hash, and PR URL.
