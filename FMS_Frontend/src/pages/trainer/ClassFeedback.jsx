import { useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { AnalyticsAPI } from '../../api/endpoints.js';
import ClassFeedbackView from '../../components/ClassFeedbackView.jsx';

export default function TrainerClassFeedback() {
  const { classId } = useParams();
  // The API enforces that this trainer owns the class (403 otherwise).
  const fetcher = useCallback(() => AnalyticsAPI.class(classId), [classId]);
  return (
    <ClassFeedbackView
      fetcher={fetcher}
      exportPath={`/export/class/${classId}`}
      exportName="class_feedback"
      backTo="/trainer"
    />
  );
}
