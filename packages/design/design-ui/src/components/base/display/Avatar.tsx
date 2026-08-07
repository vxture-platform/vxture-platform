/**
 * avatar.tsx - Avatar 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 */

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../../../utils/cn";

export interface AvatarProps extends React.ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Root
> {}

export interface AvatarImageProps extends React.ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Image
> {}

export interface AvatarFallbackProps extends React.ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Fallback
> {}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { className, ...props },
  ref,
) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex size-media-xs shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
});

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  function AvatarImage({ className, ...props }, ref) {
    return (
      <AvatarPrimitive.Image
        ref={ref}
        className={cn("aspect-square h-full w-full", className)}
        {...props}
      />
    );
  },
);

const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  function AvatarFallback({ className, ...props }, ref) {
    return (
      <AvatarPrimitive.Fallback
        ref={ref}
        className={cn(
          "flex h-full w-full items-center justify-center rounded-full bg-accent",
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Default user silhouette (identity-platform-account.md §3 D-2). `fill: currentColor` so
 * the host colors it by state via CSS `color` (e.g. brand when authenticated,
 * muted when anonymous) — an external SVG via <img> cannot inherit currentColor,
 * which is exactly why the default avatar is an inline component, not a served
 * image. Platform stores ONLY custom avatars; absence falls back here.
 */
const AvatarSilhouette = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement>
>(function AvatarSilhouette({ className, ...props }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("h-3/5 w-3/5", className)}
      {...props}
    >
      <path d="M819.2 729.088V757.76c0 33.792-27.648 61.44-61.44 61.44H266.24c-33.792 0-61.44-27.648-61.44-61.44v-28.672c0-74.752 87.04-119.808 168.96-155.648 3.072-1.024 5.12-2.048 8.192-4.096 6.144-3.072 13.312-3.072 19.456 1.024C434.176 591.872 472.064 604.16 512 604.16c39.936 0 77.824-12.288 110.592-32.768 6.144-4.096 13.312-4.096 19.456-1.024 3.072 1.024 5.12 2.048 8.192 4.096 81.92 34.816 168.96 79.872 168.96 154.624z" />
      <path d="M359.424 373.76a168.96 152.576 90 1 0 305.152 0 168.96 152.576 90 1 0-305.152 0Z" />
    </svg>
  );
});

export interface UserAvatarProps extends AvatarProps {
  /** Versioned picture URL (IdP `picture` claim); null/undefined → default silhouette. */
  src?: string | null;
  /** Accessible label / image alt (e.g. the user's name). */
  alt?: string;
}

/**
 * Drop-in user avatar: renders the custom `picture` when present, else the inline
 * default silhouette (colored by the host's text color). Mirrors the design's
 * `picture ? <img> : <DefaultAvatar/>` rule so RPs never render an empty <img>.
 */
const UserAvatar = React.forwardRef<HTMLSpanElement, UserAvatarProps>(
  function UserAvatar({ src, alt, className, ...props }, ref) {
    return (
      // key on src forces a remount when the avatar changes/clears — Radix Avatar
      // otherwise keeps a stale "loaded" status after the image unmounts, which
      // would suppress the fallback silhouette when src goes from a URL to null.
      <Avatar
        key={src ?? "__default__"}
        ref={ref}
        className={cn("text-muted-foreground", className)}
        {...props}
      >
        {src ? <AvatarImage src={src} alt={alt ?? ""} /> : null}
        <AvatarFallback delayMs={0} aria-label={alt ?? "User avatar"}>
          <AvatarSilhouette />
        </AvatarFallback>
      </Avatar>
    );
  },
);

Avatar.displayName = AvatarPrimitive.Root.displayName;
AvatarImage.displayName = AvatarPrimitive.Image.displayName;
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;
AvatarSilhouette.displayName = "AvatarSilhouette";
UserAvatar.displayName = "UserAvatar";

export { Avatar, AvatarImage, AvatarFallback, AvatarSilhouette, UserAvatar };
