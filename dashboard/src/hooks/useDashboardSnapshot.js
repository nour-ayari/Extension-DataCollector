import { useEffect, useState } from 'react'
import {
  actionDistribution,
  activityFeed,
  feedbackQueue,
  integrationChecklist,
  metricCards,
  personaBreakdown,
  recentRecommendations,
  trendData,
} from '../data/dashboardData.js'

function cloneList(list) {
  return list.map((item) => ({ ...item }))
}

function buildSnapshot() {
  return {
    metricCards: cloneList(metricCards),
    trendData: cloneList(trendData),
    personaBreakdown: cloneList(personaBreakdown),
    actionDistribution: cloneList(actionDistribution),
    recentRecommendations: cloneList(recentRecommendations),
    feedbackQueue: cloneList(feedbackQueue),
    activityFeed: cloneList(activityFeed),
    integrationChecklist: cloneList(integrationChecklist),
    refreshedAt: new Date().toISOString(),
  }
}

export function useDashboardSnapshot() {
  const [snapshot, setSnapshot] = useState(() => buildSnapshot())
  const [loading, setLoading] = useState(true)
  const [refreshIndex, setRefreshIndex] = useState(0)

  useEffect(() => {
    let active = true

    const timeoutId = window.setTimeout(() => {
      if (!active) {
        return
      }

      setSnapshot(buildSnapshot())
      setLoading(false)
    }, 450)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [refreshIndex])

  const refresh = () => {
    setLoading(true)
    setRefreshIndex((currentIndex) => currentIndex + 1)
  }

  return {
    ...snapshot,
    loading,
    refresh,
  }
}