// src/controllers/queueEngine.js
import { withDatabase } from '../utils/config.js';
import { getSolarmanDataCore } from './solarmanController.js'; 
import admin from 'firebase-admin';

export const startQueueRunner = () => {
  console.log("⏳ Mongo Queue Runner Started (30-Second Solar Report Engine)...");

  setInterval(async () => {
    try {
      const now = new Date();
      const mongoUri = process.env.MONGODB_URI;

      if (!mongoUri) return;

      await withDatabase(mongoUri, async (db) => {
        
        // 🔍 MULTI-TASK LOOKUP: Find pending solar report summaries ready to run right now
        const job = await db.collection("jobs_queue").findOneAndUpdate(
          {
            status: "pending",
            runAt: { $lte: now }
          },
          {
            $set: { status: "processing", lockedAt: now }
          },
          {
            returnDocument: "after"
          }
        );

        if (!job) return; 

        console.log(`🚀 Found active task to run: [${job.taskType}] (ID: ${job._id})`);

        // 🔀 TASK ROUTER (Only handling Solar Generation Summaries now)
        switch (job.taskType) {
          case "WEEKLY_MASTER_SOLAR_SUMMARY":
            await processAllCustomersWeeklyJobs(db, job);
            break;

          case "MONTHLY_MASTER_SOLAR_SUMMARY": 
            await processAllCustomersMonthlyJobs(db, job);
            break;

          default:
            console.log(`⚠️ Unknown or retired task type encountered: ${job.taskType}`);
            await db.collection("jobs_queue").updateOne(
              { _id: job._id },
              { $set: { status: "failed", reason: "Unknown or retired task type" } }
            );
        }
      });

    } catch (error) {
      console.error("❌ Error in Master Queue Runner loop:", error);
    }
  }, 30000);
};

export const processAllCustomersWeeklyJobs = async (db, masterJob) => {
  try {
    // ⚡ FIX: Added "UserInfo.role": "user" to isolate customer devices exclusively
    const users = await db.collection("userDetails").find({ 
      "UserInfo.role": "user",
      "PlatformInfo.devices.0": { $exists: true } 
    }).toArray();
    
    console.log(`📋 Found ${users.length} customer users with registered devices in local userDetails collection.`);

    const today = new Date();
    const currentDay = today.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startTime = monday.toISOString().split('T')[0]; 
    const endTime = sunday.toISOString().split('T')[0];

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) {
        continue;
      }

      let totalUserWeeklyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            });
          }

          totalUserWeeklyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch data for Station ${stationId}:`, stationError.message);
        }
      }

      if (processedStationsCount > 0) {
        totalUserWeeklyUnits = Number(totalUserWeeklyUnits.toFixed(2));
        const statusTitle = "☀️ Your Weekly Solar Report is Ready!";
        const finalNotificationBody = `Your weekly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserWeeklyUnits} Units`;
        
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: { title: statusTitle, body: finalNotificationBody },
          android: {
            priority: "high",
            notification: {
              channelId: "weekly_summary_channel_v1",
              sound: "default",
              clickAction: "WEEKLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: { sound: "default", category: "WEEKLY_SUMMARY_NOTIFICATION_ACTION" }
            }
          },
          data: {
            type: "weekly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserWeeklyUnits),
            show_actions: "false"
          }
        }));

        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { $pull: { "PlatformInfo.devices": { fcmToken: targetBadToken } } }
                );
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Complete breakdown executing multi-device send operation:`, multicastErr.message);
        }
      }
    }

    const nextRunTime = new Date();
    nextRunTime.setSeconds(nextRunTime.getSeconds() + 30); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", runAt: nextRunTime, lockedAt: null, lastRunAt: new Date() } }
    );

    console.log(`✅ Weekly Master Loop finished. NEXT TICK: ${nextRunTime.toLocaleTimeString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};

export const processAllCustomersMonthlyJobs = async (db, masterJob) => {
  try {
    // ⚡ FIX: Added "UserInfo.role": "user" to isolate customer devices exclusively
    const users = await db.collection("userDetails").find({ 
      "UserInfo.role": "user",
      "PlatformInfo.devices.0": { $exists: true } 
    }).toArray();
    
    console.log(`📋 Found ${users.length} customer users with registered devices in local userDetails collection.`);

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const startTime = startOfMonth.toISOString().split('T')[0]; 
    const endTime = today.toISOString().split('T')[0];

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) {
        continue;
      }

      let totalUserMonthlyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            }); 
          }                                   

          totalUserMonthlyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch monthly data for Station ${stationId}:`, stationError.message);
        }
      }

      if (processedStationsCount > 0) {
        totalUserMonthlyUnits = Number(totalUserMonthlyUnits.toFixed(2));
        const statusTitle = "☀️ Your Monthly Solar Summary is Ready!";
        const finalNotificationBody = `Your monthly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserMonthlyUnits} Units`;
        
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: { title: statusTitle, body: finalNotificationBody },
          android: {
            priority: "high",
            notification: {
              channelId: "monthly_summary_channel_v1",
              sound: "default",
              clickAction: "MONTHLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: { sound: "default", category: "MONTHLY_SUMMARY_NOTIFICATION_ACTION" }
            }
          },
          data: {
            type: "monthly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserMonthlyUnits),
            show_actions: "false"
          }
        }));

        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { $pull: { "PlatformInfo.devices": { fcmToken: targetBadToken } } }
                );
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Complete breakdown executing multi-device monthly operation:`, multicastErr.message);
        }
      }
    }

    const nextRunTime = new Date();
    nextRunTime.setSeconds(nextRunTime.getSeconds() + 30); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", runAt: nextRunTime, lockedAt: null, lastRunAt: new Date() } }
    );

    console.log(`✅ Monthly Master Loop finished. NEXT TICK: ${nextRunTime.toLocaleTimeString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Monthly Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};