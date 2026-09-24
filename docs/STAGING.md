# Staging deployment

The staging environment is an isolated copy of the GeoHealth Insights web app and API. It must never use the production MongoDB database.

## One-time setup

1. Create and push the `staging` branch before syncing the Render Blueprint.
2. In MongoDB Atlas, use a separate database name such as `geohealth_staging`. The server refuses to start in staging if the URI does not contain an explicit database name with `staging` in it.
3. Sync `render.yaml` as a Render Blueprint. It defines `geohealth-api-staging` and `geohealth-insights-staging` from the `staging` branch.
4. Configure these secret values on `geohealth-api-staging`:
   - `MONGODB_URI`: Atlas connection string ending in `/geohealth_staging`
   - `CLIENT_ORIGIN`: staging frontend URL
   - `PUBLIC_APP_URL`: staging frontend URL
   - `ADMIN_ACCESS_CODE`: a staging-only administrator code
5. Configure these values on `geohealth-insights-staging`:
   - `VITE_API_URL`: staging API URL
   - `VITE_MAPBOX_TOKEN`: Mapbox public token

Transactional email is intentionally omitted from staging so tests do not email real users.

## Verify staging

After both services are live, run from the repository root:

```cmd
npm --prefix client run smoke:staging -- https://geohealth-insights-staging.onrender.com https://geohealth-api-staging.onrender.com
```

The command checks the frontend, API liveness, database readiness, and confirms that both API health responses identify the environment as `staging`.

## Release workflow

1. Make and test changes locally.
2. Push the changes to `staging` and allow both staging services to deploy after CI passes.
3. Run `smoke:staging` and complete the intended workflow checks against staging data.
4. Merge the verified commit into `main` to deploy production.

Never copy the production `MONGODB_URI`, administrator code, or session secret into staging.
