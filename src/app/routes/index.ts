import type { RouteDefinition } from '../http/types.ts';
import { homeRoutes } from './home.ts';
import { staticRoutes } from './static.ts';
import { projectRoutes } from './projects.ts';
import { claimRoutes } from './claims.ts';
import { sourceRoutes } from './sources.ts';
import { querySetRoutes } from './querySets.ts';
import { runRoutes } from './runs.ts';
import { auditRoutes } from './audits.ts';
import { reportRoutes } from './reports.ts';

export const routes: RouteDefinition[] = [
  ...homeRoutes,
  ...projectRoutes,
  ...claimRoutes,
  ...sourceRoutes,
  ...querySetRoutes,
  ...runRoutes,
  ...auditRoutes,
  ...reportRoutes,
  ...staticRoutes,
];
