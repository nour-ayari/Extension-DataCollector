const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const integerNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

const decimalNumber = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatMetricValue(value, format = 'number') {
  switch (format) {
    case 'compact':
      return compactNumber.format(value)
    case 'ratio':
      return `${Math.round(value * 100)}%`
    case 'decimal':
      return decimalNumber.format(value)
    default:
      return integerNumber.format(value)
  }
}

export function formatConfidence(value) {
  return `${Math.round(value * 100)}%`
}

export function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value))
}