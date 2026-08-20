export default function AvailabilityPage() {
  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Availability</div>
          <h1>When you are free</h1>
        </div>
      </div>
      <p className="notice notice-muted">
        Not built yet — weekly hours, closed days, and the day-by-day view for blocking ad-hoc
        time. The underlying rules already exist and are enforced when a client books; there is
        just no screen here yet to edit them.
      </p>
    </>
  );
}
