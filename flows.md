# System Flow Mapping

Based on the codebase analysis, here are all the critical flows to test:

## Primary User Flows:
Authentication Flow: Login → Session creation → Token validation → Session persistence
Strategy Control Flow: Start strategy → Monitor status → Stop strategy → View results
Manual Trading Flow: Manual exit → Position closure → State cleanup
Dashboard Monitoring Flow: View status → Check positions → Monitor logs

## System Internal Flows:
Initialization Flow: App startup → Auth restoration → Service initialization → Ready state
Strategy Startup Flow: Contract loading → Historical data → State restoration → Validation
Price Data Flow: Manual polling → Data processing → Candle building → Storage
Breakout Detection Flow: Pivot analysis → Signal detection → Retracement validation → Trade trigger
Trade Execution Flow: Position sizing → Order placement → Confirmation → Tracking
Target/SL Management Flow: Price monitoring → Exit condition detection → Position closure
State Persistence Flow: Memory state → File persistence → State restoration → Validation
Error Recovery Flow: Error detection → Logging → Recovery actions → State cleanup

## Edge Case Flows:
Session Expiry Flow: Token expiry → Re-authentication → State recovery
Network Failure Flow: Connection loss → Retry logic → Data integrity
State Corruption Flow: Invalid data → Validation → Recovery → Clean state
External Trade Closure Flow: Manual broker action → State desync → Cleanup