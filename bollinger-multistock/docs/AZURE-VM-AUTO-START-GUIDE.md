# Azure VM Auto-Start Setup Guide

Complete guide to configure automatic VM startup on Azure using Azure Automation.

## Overview

Azure VMs support **auto-shutdown** natively, but **auto-start** requires Azure Automation with scheduled runbooks.

### Solution: Azure Automation + Managed Identity

- ✅ Free for first 500 minutes/month
- ✅ No external dependencies
- ✅ Runs entirely within Azure
- ✅ Supports weekday-only schedules
- ✅ Works with existing auto-shutdown

---

## Prerequisites

- Azure CLI installed or access to Azure Cloud Shell
- VM already created in Azure
- Contributor access to the resource group

---

## Setup Steps

### Step 1: Create Automation Account

**PowerShell/Cloud Shell:**

```powershell
az automation account create `
  --resource-group YOUR-RESOURCE-GROUP `
  --name YOUR-AUTOMATION-ACCOUNT `
  --location YOUR-LOCATION `
  --sku Basic
```

**Example:**

```powershell
az automation account create `
  --resource-group trading-bot-rg `
  --name trading-bot-automation `
  --location centralindia `
  --sku Basic
```

### Step 2: Enable Managed Identity

**Via Azure Portal:**

1. Go to **Automation Accounts** → Your automation account
2. **Account Settings** → **Identity**
3. **System assigned** tab
4. Toggle **Status** to **On**
5. Click **Save** → **Yes**
6. **Copy the Object (principal) ID** shown

### Step 3: Grant VM Start Permissions

**Via Azure Portal:**

1. Go to **Resource Groups** → Your resource group
2. **Access control (IAM)** → **Add** → **Add role assignment**
3. **Role** tab → Select `Virtual Machine Contributor`
4. **Members** tab → **Assign access to**: `Managed identity`
5. **Select members** → Choose your automation account
6. **Review + assign**

**Via PowerShell (Alternative):**

```powershell
# Get the principal ID
$principalId = (az automation account show `
  --resource-group YOUR-RESOURCE-GROUP `
  --name YOUR-AUTOMATION-ACCOUNT `
  --query identity.principalId -o tsv)

# Grant role
az role assignment create `
  --assignee $principalId `
  --role "Virtual Machine Contributor" `
  --scope "/subscriptions/YOUR-SUBSCRIPTION-ID/resourceGroups/YOUR-RESOURCE-GROUP"
```

### Step 4: Create Runbook

**Via Azure Portal:**

1. **Automation Accounts** → Your automation account
2. **Process Automation** → **Runbooks** → **Create a runbook**
3. Configure:

   - **Name**: `Start-VM`
   - **Runbook type**: `PowerShell`
   - **Runtime version**: `7.2` (recommended) or `5.1`
   - Click **Create**

4. In the editor, paste this script:

```powershell
param(
    [string]$ResourceGroupName = "YOUR-RESOURCE-GROUP",
    [string]$VMName = "YOUR-VM-NAME"
)

try {
    # Connect using Managed Identity
    Write-Output "Connecting to Azure using Managed Identity..."
    Connect-AzAccount -Identity

    Write-Output "Starting VM: $VMName in Resource Group: $ResourceGroupName"

    # Start the VM
    $result = Start-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName

    if ($result.Status -eq 'Succeeded') {
        Write-Output "✅ VM started successfully at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    } else {
        Write-Output "⚠️ VM start completed with status: $($result.Status)"
    }
}
catch {
    Write-Error "❌ Failed to start VM: $_"
    Write-Error $_.Exception.Message
    throw
}
```

5. **Update the parameter defaults** with your VM details
6. Click **Save**
7. Click **Publish** → **Yes**

### Step 5: Test the Runbook

**Via Azure Portal:**

1. In your runbook, click **Start** (top toolbar)
2. Click **OK** in the pane that opens
3. Monitor the **Output** tab
4. Verify VM status changes to "Running"

**Via PowerShell:**

```powershell
az automation runbook start `
  --resource-group YOUR-RESOURCE-GROUP `
  --automation-account-name YOUR-AUTOMATION-ACCOUNT `
  --name Start-VM
```

### Step 6: Create Schedule

**Via Azure Portal:**

1. In your runbook, click **Schedules** (left menu)
2. **Add a schedule** → **Link a schedule to your runbook**
3. **Create a new schedule**
4. Configure:
   - **Name**: `Daily-9AM-Weekdays` (or your preferred name)
   - **Description**: Auto-start VM for trading hours
   - **Starts**: Tomorrow at your desired time (e.g., 9:00 AM)
   - **Timezone**: Select your timezone (e.g., `(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi`)
   - **Recurrence**: `Recurring`
   - **Recur every**: `1 Day`
   - **Set expiration**: `No`
5. **Advanced recurrence options**:

   - ✅ Monday
   - ✅ Tuesday
   - ✅ Wednesday
   - ✅ Thursday
   - ✅ Friday
   - ❌ Saturday (uncheck if VM not needed on weekends)
   - ❌ Sunday (uncheck if VM not needed on weekends)

6. Click **Create**
7. Click **OK**

---

## Complete PowerShell Setup Script

Save this as `setup-vm-autostart.ps1`:

```powershell
# Configuration
$subscriptionId = "YOUR-SUBSCRIPTION-ID"
$resourceGroup = "YOUR-RESOURCE-GROUP"
$vmName = "YOUR-VM-NAME"
$automationAccount = "YOUR-AUTOMATION-ACCOUNT"
$location = "YOUR-LOCATION"  # e.g., centralindia, eastus, westeurope

# Set subscription
az account set --subscription $subscriptionId

# Get VM name if not specified
if ($vmName -eq "YOUR-VM-NAME") {
    Write-Host "Detecting VM name..."
    $vmName = az vm list -g $resourceGroup --query "[0].name" -o tsv
    Write-Host "Found VM: $vmName"
}

# Create automation account
Write-Host "Creating automation account..."
az automation account create `
  --resource-group $resourceGroup `
  --name $automationAccount `
  --location $location `
  --sku Basic

Write-Host "`n✅ Automation account created!"
Write-Host "`nNext steps to complete in Azure Portal:"
Write-Host "1. Enable Managed Identity:"
Write-Host "   - Go to Automation Accounts → $automationAccount → Identity"
Write-Host "   - Toggle 'Status' to 'On' and Save"
Write-Host ""
Write-Host "2. Grant VM permissions:"
Write-Host "   - Go to Resource Groups → $resourceGroup → Access control (IAM)"
Write-Host "   - Add role assignment → Virtual Machine Contributor"
Write-Host "   - Assign to managed identity → Select $automationAccount"
Write-Host ""
Write-Host "3. Create runbook with the PowerShell script (see guide)"
Write-Host "4. Create schedule for your desired startup time"
Write-Host ""
Write-Host "Resource Group: $resourceGroup"
Write-Host "VM Name: $vmName"
Write-Host "Automation Account: $automationAccount"
```

Run with:

```powershell
.\setup-vm-autostart.ps1
```

---

## Verification & Monitoring

### Check Schedule Status

**Via Azure Portal:**

1. **Automation Accounts** → Your automation account
2. **Schedules** → View all schedules and their next run time

### View Job History

**Via Azure Portal:**

1. **Automation Accounts** → Your automation account
2. **Jobs** → See all runbook executions
3. Click any job to view detailed output and logs

**Via PowerShell:**

```powershell
# List recent jobs
az automation job list `
  --resource-group YOUR-RESOURCE-GROUP `
  --automation-account-name YOUR-AUTOMATION-ACCOUNT `
  --query "[].{Name:runbookName, Status:status, StartTime:startTime}" `
  -o table
```

### Manual Start/Stop

**Start VM manually:**

```powershell
az vm start --resource-group YOUR-RESOURCE-GROUP --name YOUR-VM-NAME
```

**Stop VM manually:**

```powershell
az vm deallocate --resource-group YOUR-RESOURCE-GROUP --name YOUR-VM-NAME
```

Note: Manual stop won't affect the auto-start schedule - VM will still start at scheduled time.

---

## Troubleshooting

### Runbook Fails with Authentication Error

**Cause**: Managed identity not enabled or permissions not granted

**Solution**:

1. Verify managed identity is enabled (Identity page shows "On")
2. Check role assignment exists (Resource Group → IAM → Role assignments)
3. Wait 5-10 minutes after granting permissions for propagation

### Runbook Fails with "VM Not Found"

**Cause**: Incorrect resource group or VM name in runbook parameters

**Solution**:

1. Edit runbook and verify `$ResourceGroupName` and `$VMName` parameters
2. Or pass correct values when creating the schedule

### Schedule Not Triggering

**Cause**: Timezone mismatch or schedule not properly linked

**Solution**:

1. Check schedule timezone matches your expected timezone
2. Verify schedule is in "Enabled" state
3. Check "Next run" time is correct
4. Verify schedule is linked to runbook (Runbook → Schedules)

### VM Starts But Application Doesn't

**Cause**: Application not configured to auto-start on boot

**Solution**:

- Configure your application to auto-start (e.g., PM2 with `pm2 startup`)
- VM start only powers on the VM, application startup is separate

---

## Cost Breakdown

### Azure Automation Pricing

- **First 500 minutes/month**: FREE ✅
- **After 500 minutes**: ~$0.002/minute (~₹0.17/minute)

### Typical Usage

- 1 startup per day = ~1 minute/day
- 20 weekdays/month = 20 minutes/month
- **Total cost**: FREE (well under 500 minutes)

### Other Components

- Managed Identity: FREE ✅
- Runbook storage: FREE (up to 1GB) ✅
- Job logs (30 days retention): FREE ✅

**Total Monthly Cost for Auto-Start**: ₹0 (FREE) 🎉

---

## Advanced Configurations

### Multi-VM Auto-Start

Modify the runbook to start multiple VMs:

```powershell
param(
    [string]$ResourceGroupName = "YOUR-RESOURCE-GROUP",
    [array]$VMNames = @("vm1", "vm2", "vm3")
)

Connect-AzAccount -Identity

foreach ($vmName in $VMNames) {
    Write-Output "Starting VM: $vmName"
    Start-AzVM -ResourceGroupName $ResourceGroupName -Name $vmName -NoWait
}

Write-Output "All VM start commands issued at $(Get-Date)"
```

### Conditional Start (Skip Holidays)

```powershell
param(
    [string]$ResourceGroupName = "YOUR-RESOURCE-GROUP",
    [string]$VMName = "YOUR-VM-NAME"
)

# Define holidays (YYYY-MM-DD format)
$holidays = @(
    "2026-01-26",  # Republic Day
    "2026-08-15",  # Independence Day
    "2026-10-02"   # Gandhi Jayanti
)

$today = Get-Date -Format "yyyy-MM-dd"

if ($holidays -contains $today) {
    Write-Output "Today is a holiday ($today). Skipping VM start."
    exit 0
}

Connect-AzAccount -Identity
Write-Output "Starting VM: $VMName"
Start-AzVM -ResourceGroupName $ResourceGroupName -Name $VMName
```

### Start with Notification

Requires Logic Apps or webhook integration - see Azure documentation.

---

## Best Practices

1. **Test First**: Always test the runbook manually before scheduling
2. **Monitor Jobs**: Check job history weekly to ensure reliable operation
3. **Log Retention**: Job logs retained for 30 days - review periodically
4. **Backup Schedules**: Document your schedule configuration
5. **Timezone Awareness**: Always verify timezone settings match your expectation
6. **Security**: Use managed identity (not RunAs accounts) for better security
7. **Naming Convention**: Use descriptive names for runbooks and schedules

---

## Integration with Auto-Shutdown

Azure VMs support built-in auto-shutdown. Combined setup:

**Auto-Shutdown (Native)**:

- Portal: VM → Auto-shutdown → Enable
- Time: 4:30 PM (your local time)
- Timezone: Your timezone
- Notifications: Optional

**Auto-Start (Automation)**:

- This guide
- Time: 9:00 AM (your local time)
- Days: Weekdays only

Result: VM runs only during business hours, automatically! ✅

---

## Quick Reference

### Essential Commands

```powershell
# Start VM manually
az vm start -g RESOURCE-GROUP -n VM-NAME

# Stop VM manually
az vm deallocate -g RESOURCE-GROUP -n VM-NAME

# Check VM status
az vm show -g RESOURCE-GROUP -n VM-NAME -d --query powerState -o tsv

# Test runbook
az automation runbook start -g RESOURCE-GROUP --automation-account-name ACCOUNT --name RUNBOOK-NAME

# List schedules
az automation schedule list -g RESOURCE-GROUP --automation-account-name ACCOUNT -o table

# View recent jobs
az automation job list -g RESOURCE-GROUP --automation-account-name ACCOUNT -o table
```

---

## Example: Trading Bot VM

**Configuration Used**:

- Resource Group: `trading-bot-rg`
- VM Name: `nifty-trading-bot`
- Location: `centralindia`
- Automation Account: `trading-bot-automation`
- Schedule: 9:00 AM IST, Monday-Friday
- Auto-Shutdown: 4:30 PM IST, Daily

**Result**: VM automatically runs 9 AM - 4:30 PM on weekdays for market hours.

---

## Resources

- [Azure Automation Documentation](https://docs.microsoft.com/en-us/azure/automation/)
- [Managed Identities Overview](https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/overview)
- [Azure Automation Pricing](https://azure.microsoft.com/en-us/pricing/details/automation/)
- [PowerShell Runbook Tutorial](https://docs.microsoft.com/en-us/azure/automation/learn/automation-tutorial-runbook-textual-powershell)

---

**Last Updated**: January 6, 2026
