import { cn } from "@/lib/utils";

type DefaultUserAvatarProps = {
  className?: string;
  title?: string;
};

export function DefaultUserAvatar({
  className,
  title = "默认用户头像",
}: DefaultUserAvatarProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1254 1254"
      fill="none"
      role="img"
      aria-label={title}
      className={cn("shrink-0 select-none", className)}
    >
      <ellipse cx="627" cy="643" rx="502" ry="507" fill="#CCDFD7" />
      <path
        fill="#3D776D"
        fillRule="evenodd"
        d="M783 544.5C783 627 713 694 627 694S471 627 471 544.5S541 395 627 395S783 462 783 544.5ZM739 544C739 604 689 652 627 652S514 604 514 544S564 435 627 435S739 484 739 544Z"
        clipRule="evenodd"
      />
      <path
        d="M412.5 896.5V883C412.5 796 499 728 608 728H646C755 728 839.5 796 839.5 883V896.5"
        stroke="#3D776D"
        strokeWidth="43"
        strokeLinecap="round"
      />
    </svg>
  );
}
