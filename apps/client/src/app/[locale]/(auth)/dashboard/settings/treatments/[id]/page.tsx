'use client';

import { use } from 'react';

import { PreventivePlanDetailView } from '@/features/preventives/PreventivePlanDetailView';

const TreatmentDetailPage = (props: { params: Promise<{ id: string }> }) => {
  const params = use(props.params);
  return <PreventivePlanDetailView planId={params.id} />;
};

export default TreatmentDetailPage;
