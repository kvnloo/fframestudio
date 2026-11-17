# Root cause
CI runner image updated from `20261025.353.1` to `20261101.360.1` with Chrome 157.0.8103.38. The hosted journey 'read-only folder import keeps only project files and sends nothing' times out at 30s when selecting 3000 files via webkitdirectory picker on the new environment.

# Change
- `test/hosted-journey.mjs`: Increased `setInputFiles` timeout from default 30s to 60s to accommodate the newer CI runner/Chrome combination. Test logic is identical — still verifies only project files are kept and nothing is sent over the network.

# Verification
Local `npm run verify` run passes: `ok   hosted: read-only folder import keeps only project files and sends nothing`

# Check runs (expected)
- verify: should turn from red to green on main
- All other checks unchanged

tests:
  red: hosted: read-only folder import keeps only project files and sends nothing (run 42481779883)
  green: hosted: read-only folder import keeps only project files and sends nothing (fixed with timeout increase)