import { useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { AnalyticsAPI } from '../../api/endpoints.js';
import ClassFeedbackView from '../../components/ClassFeedbackView.jsx';

export default function AdminClassFeedback() {
  const { classId } = useParams();
  const fetcher = useCallback(() => AnalyticsAPI.class(classId), [classId]);
  // basePath lets the year-group breakdown deep-link into each batch
  // under the right role prefix.
  return (
    <ClassFeedbackView
      fetcher={fetcher}
      // What to load. The view keys its effect on this, so changing the id
      // refetches while an unstable fetcher identity cannot loop.
      reloadKey={classId}
      exportPath={`/export/class/${classId}`}
      exportName="class_feedback"
      backTo="/admin/feedbacks"  /* fallback when there is no in-app history */
      basePath="/admin"
    />
  );
}
