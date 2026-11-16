import { AppConfig } from '@/utils/AppConfig';

export const Logo = (props: {
  isTextHidden?: boolean;
}) => (
  <div className="flex items-center text-xl font-semibold">
    <svg
      className="mr-1 size-8 stroke-current stroke-2"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head */}
      <circle cx="12" cy="8" r="4.5" />

      {/* Shoulders / neck */}
      <path d="M7 21a5 5 0 0 1 10 0" />

      {/* Lightning bolt inside the head */}
      <path d="M12.5 4.5 10.5 8h2L11 11.5" />
    </svg>

    {!props.isTextHidden && AppConfig.name}
  </div>
);
