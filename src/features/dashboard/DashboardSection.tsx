export const DashboardSection = (props: {
  title: string | React.ReactNode;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl bg-card p-5 shadow-sm">
    <div className="text-lg font-semibold">{props.title}</div>

    <div className="mb-4 text-sm font-medium text-muted-foreground">
      {props.description}
    </div>

    {props.children}
  </div>
);
