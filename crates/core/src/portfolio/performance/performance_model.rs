use crate::portfolio::economic_events::BasisStatus;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CumulativeReturn {
    pub date: NaiveDate,
    pub value: Decimal,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TotalReturn {
    pub rate: Decimal,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ReturnMethod {
    #[default]
    TimeWeighted,
    ValueReturn,
    SymbolPriceBased,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReturnData {
    pub date: NaiveDate,
    pub value: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceScopeDescriptor {
    pub id: String,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePeriod {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceReturns {
    pub twr: Option<Decimal>,
    pub annualized_twr: Option<Decimal>,
    /// Selected-period money-weighted return derived from annualized XIRR.
    pub irr: Option<Decimal>,
    /// Annualized XIRR using dated cash flows.
    pub annualized_irr: Option<Decimal>,
    pub value_return: Option<Decimal>,
    pub annualized_value_return: Option<Decimal>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceSummaryProfile {
    #[default]
    Full,
    #[serde(alias = "headline")]
    Summary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceAttribution {
    pub contributions: Decimal,
    pub distributions: Decimal,
    pub income: Decimal,
    pub realized_pnl: Decimal,
    pub unrealized_pnl_change: Decimal,
    pub fx_effect: Decimal,
    pub fees: Decimal,
    pub taxes: Decimal,
    pub residual: Decimal,
}

impl Default for PerformanceAttribution {
    fn default() -> Self {
        Self {
            contributions: Decimal::ZERO,
            distributions: Decimal::ZERO,
            income: Decimal::ZERO,
            realized_pnl: Decimal::ZERO,
            unrealized_pnl_change: Decimal::ZERO,
            fx_effect: Decimal::ZERO,
            fees: Decimal::ZERO,
            taxes: Decimal::ZERO,
            residual: Decimal::ZERO,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceRisk {
    pub volatility: Option<Decimal>,
    pub max_drawdown: Option<Decimal>,
    pub peak_date: Option<NaiveDate>,
    pub trough_date: Option<NaiveDate>,
    pub recovery_date: Option<NaiveDate>,
    pub drawdown_duration_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DataQualityStatus {
    Ok,
    Partial,
    NoData,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDataQuality {
    pub status: DataQualityStatus,
    pub warnings: Vec<String>,
    pub not_applicable_reasons: Vec<String>,
}

impl PerformanceDataQuality {
    pub fn ok() -> Self {
        Self {
            status: DataQualityStatus::Ok,
            warnings: Vec::new(),
            not_applicable_reasons: Vec::new(),
        }
    }

    pub fn no_data(reason: impl Into<String>) -> Self {
        Self {
            status: DataQualityStatus::NoData,
            warnings: Vec::new(),
            not_applicable_reasons: vec![reason.into()],
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceSummaryBasis {
    MarketValue,
    BookBasis,
    Mixed,
    #[default]
    NotApplicable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceSummaryStatus {
    Complete,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSummary {
    pub amount: Option<Decimal>,
    pub percent: Option<Decimal>,
    pub method: ReturnMethod,
    pub basis: PerformanceSummaryBasis,
    pub quality: DataQualityStatus,
    pub amount_status: PerformanceSummaryStatus,
    pub percent_status: PerformanceSummaryStatus,
    pub basis_status: BasisStatus,
    pub reasons: Vec<String>,
}

impl Default for PerformanceSummary {
    fn default() -> Self {
        Self {
            amount: None,
            percent: None,
            method: ReturnMethod::NotApplicable,
            basis: PerformanceSummaryBasis::NotApplicable,
            quality: DataQualityStatus::NotApplicable,
            amount_status: PerformanceSummaryStatus::Unavailable,
            percent_status: PerformanceSummaryStatus::Unavailable,
            basis_status: BasisStatus::NotApplicable,
            reasons: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResult {
    pub scope: PerformanceScopeDescriptor,
    pub period: PerformancePeriod,
    pub mode: ReturnMethod,
    pub returns: PerformanceReturns,
    pub attribution: PerformanceAttribution,
    pub risk: PerformanceRisk,
    pub data_quality: PerformanceDataQuality,
    #[serde(default)]
    pub basis_status: BasisStatus,
    #[serde(default, alias = "headline")]
    pub summary: PerformanceSummary,
    pub series: Vec<ReturnData>,
    #[serde(default)]
    pub is_holdings_mode: bool,
    #[serde(default)]
    pub is_mixed_tracking_mode: bool,
}

// This struct now only holds the calculated performance metrics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimplePerformanceMetrics {
    pub account_id: String,
    pub account_currency: Option<String>,
    pub base_currency: Option<String>,
    pub fx_rate_to_base: Option<Decimal>,
    pub total_value: Option<Decimal>,
    pub total_gain_loss_amount: Option<Decimal>,
    pub cumulative_return_percent: Option<Decimal>,
    pub portfolio_weight: Option<Decimal>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portfolio::economic_events::BasisStatus;
    use chrono::NaiveDate;
    use serde_json::json;

    #[test]
    fn performance_result_serializes_typed_summary_contract() {
        let result = PerformanceResult {
            scope: PerformanceScopeDescriptor {
                id: "scope-1".to_string(),
                currency: "CAD".to_string(),
            },
            period: PerformancePeriod {
                start_date: Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()),
                end_date: Some(NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()),
            },
            mode: ReturnMethod::ValueReturn,
            returns: PerformanceReturns {
                twr: None,
                annualized_twr: None,
                irr: None,
                annualized_irr: None,
                value_return: Some(Decimal::new(12, 2)),
                annualized_value_return: None,
            },
            attribution: PerformanceAttribution::default(),
            risk: PerformanceRisk {
                volatility: None,
                max_drawdown: None,
                peak_date: None,
                trough_date: None,
                recovery_date: None,
                drawdown_duration_days: None,
            },
            data_quality: PerformanceDataQuality {
                status: DataQualityStatus::Partial,
                warnings: vec!["display warning".to_string()],
                not_applicable_reasons: vec!["display reason".to_string()],
            },
            basis_status: BasisStatus::PartialUnknown,
            summary: PerformanceSummary {
                amount: Some(Decimal::new(1234, 2)),
                percent: None,
                method: ReturnMethod::ValueReturn,
                basis: PerformanceSummaryBasis::Mixed,
                quality: DataQualityStatus::Partial,
                amount_status: PerformanceSummaryStatus::Complete,
                percent_status: PerformanceSummaryStatus::Unavailable,
                basis_status: BasisStatus::PartialUnknown,
                reasons: vec!["display reason".to_string()],
            },
            series: Vec::new(),
            is_holdings_mode: false,
            is_mixed_tracking_mode: true,
        };

        let value = serde_json::to_value(&result).expect("performance result should serialize");

        assert_eq!(value["mode"], json!("valueReturn"));
        assert_eq!(value["basisStatus"], json!("partialUnknown"));
        assert_eq!(value["isMixedTrackingMode"], json!(true));
        assert!(value.get("headline").is_none());
        assert!(value["summary"].get("componentCoverage").is_none());
        assert_eq!(value["summary"]["method"], json!("valueReturn"));
        assert_eq!(value["summary"]["basis"], json!("mixed"));
        assert_eq!(value["summary"]["quality"], json!("partial"));
        assert_eq!(value["summary"]["amountStatus"], json!("complete"));
        assert_eq!(value["summary"]["percentStatus"], json!("unavailable"));
        assert_eq!(value["summary"]["basisStatus"], json!("partialUnknown"));
        assert_eq!(value["summary"]["reasons"][0], json!("display reason"));
    }
}
