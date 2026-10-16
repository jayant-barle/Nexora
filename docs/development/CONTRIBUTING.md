# Contributing to Nexora

Thank you for your interest in contributing to **Nexora**! We welcome contributions from developers, designers, and documentation architects. Please review this guide to understand our engineering standards, development workflow, and pull request process.

---

## 1. Development Environment Setup

### 1.1 Prerequisites
- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Node.js**: `v18.0.0` or newer (`v20+` or `v22+` recommended)
- **npm**: `v9.0.0` or newer
- **Python**: `v3.10` or newer (available on system `PATH` as `python`)
- **Build Tools**: Visual Studio C++ Build Tools or Windows SDK (for compiling native Node addons)

### 1.2 Local Setup
1. Fork and clone the repository:
   ```bash
   git clone https://github.com/your-username/nexora.git
   cd "nexora"
   ```

2. Install Node.js dependencies:
   ```bash
   npm install --ignore-scripts
   ```

3. Rebuild native modules for Electron:
   ```bash
   npx electron-builder install-app-deps
   ```

4. Verify the setup by running the test suite:
   ```bash
   npm test
   ```

5. Launch the application in development mode:
   ```bash
   npm run dev
   ```

---

## 2. Engineering Standards & Code Conventions

### 2.1 TypeScript & Type Safety
- **Strict Mode**: All code must strictly satisfy `strict: true` without errors. Avoid `any` types wherever possible; use `unknown` with explicit type guards.
- **Shared Contracts**: Common entities, IPC channels, and settings must be defined inside [src/shared/types.ts](file:///e:/Code%20Tresure/File%20manager/src/shared/types.ts) and imported via the `@shared` path alias.
- **Type Checking**: Verify your code before committing:
  ```bash
  npm run typecheck
  npm run typecheck:main
  ```

### 2.2 React & Frontend Architecture
- **Functional Components**: Use React functional components with `React.FC` or typed props.
- **State Management**: Use Zustand stores in [src/renderer/store/index.ts](file:///e:/Code%20Tresure/File%20manager/src/renderer/store/index.ts) for application-wide state. Keep local state (`useState`) within individual components when not shared.
- **API Access**: Access desktop capabilities strictly through the type-safe [src/renderer/services/api.ts](file:///e:/Code%20Tresure/File%20manager/src/renderer/services/api.ts) bridge. Never assume `window.electronAPI` is globally typed without the bridge.

### 2.3 CSS & Design System
- **Use Design Tokens**: Never hardcode hex values or magic numbers. Always reference variables from [tokens.css](file:///e:/Code%20Tresure/File%20manager/src/renderer/styles/tokens.css):
  - Colors: `var(--color-bg-primary)`, `var(--color-accent)`, `var(--color-text-secondary)`
  - Spacing: `var(--space-2)`, `var(--space-4)`, `var(--space-6)`
  - Radii: `var(--radius-sm)`, `var(--radius-md)`, `var(--radius-lg)`
- **Animation & Transitions**: Use defined transitions (`var(--transition-fast)`, `var(--transition-normal)`) for smooth interactions.

### 2.4 Main Process & Security
- **Parameter Validation**: Every new IPC handler in [src/main/ipc-handlers.ts](file:///e:/Code%20Tresure/File%20manager/src/main/ipc-handlers.ts) must validate incoming arguments using `validatePath()`, `validateString()`, or `validateId()`.
- **Zero-Block Principle**: Never run synchronous heavy computational tasks in the Electron main thread. Long operations must be dispatched to the background job queue or the Python worker.
- **Non-Destructive Operations**: Never write code that directly deletes or overwrites user media without explicit confirmation and hash verification.

---

## 3. Git Workflow & Commit Guidelines

### 3.1 Branch Naming Conventions
- `feature/<short-description>`: New features or UI enhancements
- `bugfix/<issue-number>-<short-description>`: Bug fixes
- `refactor/<short-description>`: Code cleanup without functional changes
- `docs/<short-description>`: Documentation additions or updates
- `test/<short-description>`: Test additions or test framework adjustments

### 3.2 Commit Message Standards
We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```
**Types**:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (formatting, tokens)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to build process, dependencies, or tool configurations

**Example**:
```
feat(duplicates): add perceptual similarity filtering tab
fix(ipc): sanitize incoming path arguments against null-byte injection
docs(readme): add troubleshooting section for better-sqlite3 bindings
```

---

## 4. Pull Request Submission Checklist

Before submitting a Pull Request, ensure that:
- [ ] Dependencies install cleanly: `npm install --ignore-scripts`
- [ ] TypeScript compiles with zero errors: `npm run typecheck && npm run typecheck:main`
- [ ] All unit tests pass: `npm test`
- [ ] Production build succeeds: `npm run build`
- [ ] Code follows the established styling tokens and design system.
- [ ] Relevant documentation has been updated to reflect any new or modified functionality.
- [ ] PR description clearly explains the changes and references any related issues.

---

## 5. Version Management & Release Workflow

Nexora adheres strictly to [Semantic Versioning (SemVer 2.0.0)](https://semver.org/):

$$\text{MAJOR}.\text{MINOR}.\text{PATCH}$$

- **`MAJOR`**: Incompatible architectural breaking changes or major framework shifts.
- **`MINOR`**: New backward-compatible capabilities, views, or AI pipelines.
- **`PATCH`**: Backward-compatible bug fixes, security patches, or documentation updates.

### 5.1. Canonical Version Single Source of Truth
1. The **canonical version** of the project is defined in the root [VERSION](file:///e:/Code%20Tresure/File%20manager/VERSION) file and mirrored in [package.json](file:///e:/Code%20Tresure/File%20manager/package.json).
2. The version must remain consistent across:
   - [VERSION](file:///e:/Code%20Tresure/File%20manager/VERSION)
   - [package.json](file:///e:/Code%20Tresure/File%20manager/package.json)
   - [README.md](file:///e:/Code%20Tresure/File%20manager/README.md)
   - [CHANGELOG.md](file:///e:/Code%20Tresure/File%20manager/CHANGELOG.md)
   - UI application telemetry in [SettingsPage.tsx](file:///e:/Code%20Tresure/File%20manager/src/renderer/pages/SettingsPage.tsx) via `electronAPI.app.getVersion()`.

### 5.2. Mandatory Version Update Workflow
Whenever a meaningful project modification is performed, engineers and coding agents must execute the following 9-step workflow:

1. **Inspect Status**: Inspect the current project version (`VERSION`, `package.json`) and repository status (`git status`).
2. **Review Scope**: Review the requested changes and determine whether they represent a `PATCH`, `MINOR`, or `MAJOR` increment.
3. **Identify Increment**: Establish the target version according to SemVer rules (do not bump versions for trivial typos).
4. **Implement Safely**: Implement requested code changes without disturbing unrelated features or breaking existing invariants.
5. **Execute Validation**: Run full validation test suites (`npm test`, `npm run typecheck`, `npm run build`).
6. **Update Changelog**: Add an entry in [CHANGELOG.md](file:///e:/Code%20Tresure/File%20manager/CHANGELOG.md) formatted with the version, date, categorized sections (`Added`, `Changed`, `Fixed`, `Security and Privacy`, `Documentation`, `Affected Areas`, `Validation`).
7. **Synchronize Version**: Update the canonical version in [VERSION](file:///e:/Code%20Tresure/File%20manager/VERSION) and [package.json](file:///e:/Code%20Tresure/File%20manager/package.json) when a release version changes.
8. **Update Documentation**: Update [README.md](file:///e:/Code%20Tresure/File%20manager/README.md) and specialized technical documentation when project behavior or setup changes.
9. **Deliver Report**: Report the old version, new version, files modified, tests performed, and any unresolved issues or TODOs.
