/**
 * Segment-aware sidebar route matching.
 * @package @vxture/console
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-11
 */
/**
 * @param pathname - Locale-free current route.
 * @param href - Navigation entry route.
 * @returns Whether the route belongs to this entry at a segment boundary.
 */
export function isNavigationActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
