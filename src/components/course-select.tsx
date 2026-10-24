export type CourseOption = { id: string; code: string; title: string };

export function CourseSelect({
  courses,
  defaultValue,
}: {
  courses: CourseOption[];
  defaultValue?: string | null;
}) {
  if (courses.length === 0) return null;

  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      Course
      <select
        name="courseId"
        defaultValue={defaultValue ?? ""}
        aria-label="Course"
        className="rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">No course</option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.code} — {course.title}
          </option>
        ))}
      </select>
    </label>
  );
}
