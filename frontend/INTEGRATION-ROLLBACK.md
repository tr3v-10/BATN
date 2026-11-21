# Frontend rollback

The pre-integration frontend is preserved in `frontend-legacy/`.

## Fast rollback on the feature branch

From the repository root:

```bash
git switch feature/updated-frontend-integration
git rm -r frontend
cp -R frontend-legacy frontend
git add frontend
git commit -m "Restore legacy BATN frontend"
```

Alternatively, revert the frontend integration commit on this branch:

```bash
git log --oneline
git revert <frontend-integration-commit-sha>
```

The `main` branch was not changed by this integration. To abandon the preview entirely, simply continue using `main`.
