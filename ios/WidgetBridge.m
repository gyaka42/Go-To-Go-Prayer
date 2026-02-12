#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WidgetBridge, NSObject)
RCT_EXTERN_METHOD(saveWidgetData:(NSString *)nextPrayer
                  time:(NSString *)time
                  location:(NSString *)location)
@end
