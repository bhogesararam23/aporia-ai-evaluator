import type { RouteDefinition } from '../http/types.ts';
import { homeRoutes } from './home.ts';
import { staticRoutes } from './static.ts';
import { projectRoutes } from './projects.ts';

export const routes: RouteDefinition[] = [...homeRoutes, ...projectRoutes, ...staticRoutes];
