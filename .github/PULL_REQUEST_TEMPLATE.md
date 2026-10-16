## Description
Provide a concise explanation of what this pull request changes and the architectural rationale.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance optimization
- [ ] Code refactoring / Repository hygiene

## Invariant Checklist
- [ ] **100% Local-First**: No remote API calls, analytics, or telemetry introduced.
- [ ] **Original File Immutability**: No automated operations move, mutate, or delete original files.
- [ ] **Zero Accuracy Loss**: Model resolution and confidence thresholds remain intact.
- [ ] **TypeScript Types**: `npm run typecheck` and `npm run typecheck:main` pass with 0 errors.
- [ ] **Test Verification**: `npm test` passes 100% of test suites.
- [ ] **Production Build**: `npm run build` succeeds cleanly.
